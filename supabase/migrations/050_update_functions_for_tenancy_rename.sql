-- 050_update_functions_for_tenancy_rename.sql
--
-- Repoint every stored function at the renamed columns.
--
-- This is the migration it would be easiest to forget, and the most expensive to
-- forget. PostgreSQL does not track column references inside function bodies:
-- migration 048 renames the columns and every one of these functions keeps
-- compiling, then fails at runtime the first time it is called. Two of the four
-- are on live paths - the durable send queue and demo seeding.
--
-- Must be applied together with 048. Splitting them leaves a window where sends
-- fail.
--
-- Three pre-existing bugs are fixed here as well, because they are inside
-- function bodies that have to be rewritten regardless. They are unrelated to the
-- rename and are called out individually below.

-- ---------------------------------------------------------------------------
-- 1. enqueue_campaign_recipients
--
--    Resolves a campaign's audience entirely in SQL. Two changes:
--      * s.client_id -> s.workspace_id
--      * the INSERT must now populate campaign_job_recipients.workspace_id,
--        which migration 048 added as NOT NULL. Without this the function fails
--        on every call and no campaign can be queued.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enqueue_campaign_recipients(
  p_job_id      UUID,
  p_workspace   UUID,
  p_audience    TEXT DEFAULT 'confirmed',
  p_list_id     UUID DEFAULT NULL,
  p_country     TEXT DEFAULT NULL,
  p_regions     TEXT[] DEFAULT NULL,
  p_cities      TEXT[] DEFAULT NULL,
  p_center_lat  DOUBLE PRECISION DEFAULT NULL,
  p_center_lng  DOUBLE PRECISION DEFAULT NULL,
  p_radius_km   DOUBLE PRECISION DEFAULT NULL
) RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH inserted AS (
    INSERT INTO campaign_job_recipients (job_id, subscriber_id, workspace_id)
    SELECT p_job_id, s.id, p_workspace
    FROM subscribers s
    WHERE s.workspace_id = p_workspace
      AND s.suppressed = false
      AND s.email IS NOT NULL
      AND s.email <> ''

      -- Audience
      AND (p_audience <> 'confirmed' OR s.confirmed = true)
      AND (p_audience <> 'pending'   OR s.confirmed = false)
      AND (
        p_audience <> 'claimed_offer'
        OR (s.confirmed = true AND EXISTS (
              SELECT 1 FROM campaign_events e
              WHERE e.subscriber_id = s.id
                AND e.event_type = 'click'
                AND e.metadata->>'tracking_kind' = 'lead_magnet'))
      )

      -- Explicit list membership (audience "list:<uuid>")
      AND (
        p_list_id IS NULL
        OR EXISTS (SELECT 1 FROM subscriber_list_memberships m
                   WHERE m.subscriber_id = s.id AND m.list_id = p_list_id)
      )

      -- Geo
      AND (p_country IS NULL OR s.country = p_country)
      AND (p_regions IS NULL OR cardinality(p_regions) = 0 OR s.region = ANY(p_regions))
      AND (p_cities  IS NULL OR cardinality(p_cities)  = 0 OR s.city   = ANY(p_cities))

      -- Radius. Haversine inline rather than the earthdistance extension: one
      -- fewer dependency, and this is not a hot path.
      AND (
        p_radius_km IS NULL OR p_center_lat IS NULL OR p_center_lng IS NULL
        OR (
          s.latitude IS NOT NULL AND s.longitude IS NOT NULL
          AND 6371 * acos(least(1, greatest(-1,
                cos(radians(p_center_lat)) * cos(radians(s.latitude)) *
                cos(radians(s.longitude) - radians(p_center_lng)) +
                sin(radians(p_center_lat)) * sin(radians(s.latitude))
              ))) <= p_radius_km
        )
      )
    ON CONFLICT (job_id, subscriber_id) DO NOTHING
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::INTEGER FROM inserted;
$$;

-- ---------------------------------------------------------------------------
-- 2. auth_admin_login
--
--    Returns admin_users.client_id, now scoped_workspace_id. The return type
--    changes, so this needs DROP rather than CREATE OR REPLACE.
--
--    Note: this function has no caller anywhere in the application - admin login
--    does not go through it. It is updated to keep the schema consistent rather
--    than because anything depends on it, and it is a candidate for deletion.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.auth_admin_login(text, text);

CREATE FUNCTION public.auth_admin_login(p_username text, p_password text)
RETURNS TABLE(user_id uuid, username text, role text, scoped_workspace_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  select au.id, au.username, au.role, au.scoped_workspace_id
  from public.admin_users au
  where au.active = true
    and au.username = p_username
    and au.password_hash = extensions.crypt(p_password, au.password_hash)
  limit 1;
$$;

COMMENT ON FUNCTION public.auth_admin_login(text, text)
IS 'Authenticate an admin user by username and password against bcrypt hash. '
   'Currently unreferenced by the application.';

-- ---------------------------------------------------------------------------
-- 3. create_admin_user
--
--    A parameter name cannot be changed by CREATE OR REPLACE, so this is a
--    DROP and recreate. The caller in app/api/admin/users/route.ts is updated
--    in the same commit.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_admin_user(text, text, text, uuid);

CREATE FUNCTION public.create_admin_user(
  p_username             text,
  p_password             text,
  p_role                 text,
  p_scoped_workspace_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  new_id uuid;
begin
  if p_username is null or btrim(p_username) = '' then
    raise exception 'Username is required';
  end if;

  if p_password is null or length(p_password) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;

  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'Invalid role';
  end if;

  if p_role <> 'owner' and p_scoped_workspace_id is null then
    raise exception 'A workspace is required for editor/viewer';
  end if;

  insert into public.admin_users (username, password_hash, role, scoped_workspace_id)
  values (
    lower(btrim(p_username)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    p_role,
    p_scoped_workspace_id
  )
  returning id into new_id;

  return new_id;
end;
$$;

COMMENT ON FUNCTION public.create_admin_user(text, text, text, uuid)
IS 'Create a platform admin user with a hashed password.';

-- ---------------------------------------------------------------------------
-- 4. seed_demo_data
--
--    Rename changes: client_id -> workspace_id throughout, and campaign_events
--    inserts must now carry workspace_id.
--
--    THREE PRE-EXISTING BUGS ARE FIXED HERE, all predating this work:
--
--    (a) The function could never complete. It computed `age` as
--        (v_now - last_sent_at), which is an INTERVAL, then inserted that
--        expression into campaign_events.occurred_at, which is TIMESTAMPTZ.
--        Postgres has no cast between the two ("cannot cast type interval to
--        timestamp with time zone"), so the first event insert aborted the whole
--        transaction. Every seeded campaign has status 'sent' and a non-zero
--        sent_count, so this fired every time. Demo seeding has been broken.
--        Fixed by using last_sent_at as the base timestamp, which is what the
--        surrounding arithmetic clearly intended.
--
--    (b) region and city were swapped on insert. The column list reads
--        (..., country, region, city, ...) but the values read
--        (..., 'US', s.city, s.region, ...), so Los Angeles was stored with
--        region='Los Angeles', city='California'. Visible in the demo's geo
--        filter and radius search.
--
--    (c) The cleanup step reached campaign_events, campaign_jobs and
--        subscriber_list_memberships through subqueries because those tables had
--        no tenancy column. They have one now, so the deletes are direct - which
--        is also the first small demonstration that adding the key pays for
--        itself in ordinary queries, not just in policies.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seed_demo_data(p_workspace_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_sub_count INT := 0;
  v_camp_count INT := 0;
  v_event_count INT := 0;
  v_now TIMESTAMPTZ := NOW();
  v_subscriber_ids UUID[];
  v_campaign RECORD;
  v_sub RECORD;
  v_sent INT;
  v_opened INT;
  v_clicked INT;
  v_open_rate FLOAT;
  v_click_rate FLOAT;
  v_hour INT;
  v_day_offset INT;
  v_i INT;
BEGIN
  -- 1. Clean existing demo data
  DELETE FROM campaign_events              WHERE workspace_id = p_workspace_id;
  DELETE FROM campaign_jobs                WHERE workspace_id = p_workspace_id;
  DELETE FROM campaigns                    WHERE workspace_id = p_workspace_id;
  DELETE FROM subscriber_list_memberships  WHERE workspace_id = p_workspace_id;
  DELETE FROM subscribers                  WHERE workspace_id = p_workspace_id;

  -- 2. Generate 200 subscribers across the US
  WITH cities AS (
    SELECT * FROM (VALUES
      ('New York','New York',40.7128,-74.0060),
      ('Los Angeles','California',34.0522,-118.2437),
      ('Chicago','Illinois',41.8781,-87.6298),
      ('Houston','Texas',29.7604,-95.3698),
      ('Phoenix','Arizona',33.4484,-112.0740),
      ('Philadelphia','Pennsylvania',39.9526,-75.1652),
      ('San Antonio','Texas',29.4241,-98.4936),
      ('San Diego','California',32.7157,-117.1611),
      ('Dallas','Texas',32.7767,-96.7970),
      ('Austin','Texas',30.2672,-97.7431),
      ('San Jose','California',37.3382,-121.8863),
      ('Jacksonville','Florida',30.3322,-81.6557),
      ('Columbus','Ohio',39.9612,-82.9988),
      ('Charlotte','North Carolina',35.2271,-80.8431),
      ('San Francisco','California',37.7749,-122.4194),
      ('Seattle','Washington',47.6062,-122.3321),
      ('Denver','Colorado',39.7392,-104.9903),
      ('Nashville','Tennessee',36.1627,-86.7816),
      ('Portland','Oregon',45.5152,-122.6784),
      ('Las Vegas','Nevada',36.1699,-115.1398),
      ('Atlanta','Georgia',33.7490,-84.3880),
      ('Miami','Florida',25.7617,-80.1918),
      ('Detroit','Michigan',42.3314,-83.0458),
      ('Minneapolis','Minnesota',44.9778,-93.2650),
      ('Tampa','Florida',27.9506,-82.4572),
      ('St. Louis','Missouri',38.6270,-90.1994),
      ('Pittsburgh','Pennsylvania',40.4406,-79.9959),
      ('Cincinnati','Ohio',39.1031,-84.5120),
      ('Kansas City','Missouri',39.0997,-94.5786),
      ('Indianapolis','Indiana',39.7684,-86.1581),
      ('Cleveland','Ohio',41.4993,-81.6944),
      ('Raleigh','North Carolina',35.7796,-78.6382),
      ('Milwaukee','Wisconsin',43.0389,-87.9065),
      ('Baltimore','Maryland',39.2904,-76.6122),
      ('Louisville','Kentucky',38.2527,-85.7585),
      ('Memphis','Tennessee',35.1495,-90.0490),
      ('Richmond','Virginia',37.5407,-77.4360),
      ('Oklahoma City','Oklahoma',35.4676,-97.5164),
      ('Birmingham','Alabama',33.5186,-86.8104),
      ('Buffalo','New York',42.8864,-78.8784),
      ('Hartford','Connecticut',41.7658,-72.6734),
      ('New Orleans','Louisiana',29.9511,-90.0715),
      ('Salt Lake City','Utah',40.7608,-111.8910),
      ('Omaha','Nebraska',41.2565,-95.9345),
      ('Albuquerque','New Mexico',35.0853,-106.6056),
      ('Providence','Rhode Island',41.8240,-71.4128),
      ('Charleston','South Carolina',32.7765,-79.9311),
      ('Madison','Wisconsin',43.0731,-89.4012),
      ('Boise','Idaho',43.6150,-116.2023),
      ('Des Moines','Iowa',41.5868,-93.6250)
    ) AS t(city, region, lat, lng)
  ),
  names AS (
    SELECT * FROM (VALUES
      ('Alex','Smith'),('Maria','Johnson'),('James','Williams'),('Sarah','Brown'),('David','Jones'),
      ('Emma','Garcia'),('Michael','Miller'),('Lisa','Davis'),('Tom','Rodriguez'),('Rachel','Martinez'),
      ('Chris','Hernandez'),('Jenny','Lopez'),('Ryan','Gonzalez'),('Olivia','Wilson'),('Kevin','Anderson'),
      ('Sophie','Thomas'),('Brian','Taylor'),('Amanda','Moore'),('Jason','Jackson'),('Nicole','Martin'),
      ('Derek','Lee'),('Laura','Perez'),('Eric','Thompson'),('Megan','White'),('Sean','Harris'),
      ('Katie','Sanchez'),('Adam','Clark'),('Lauren','Ramirez'),('Nathan','Lewis'),('Julia','Robinson'),
      ('Aaron','Walker'),('Stephanie','Young'),('Ben','Allen'),('Hannah','King'),('Tyler','Wright'),
      ('Emily','Scott'),('Zach','Torres'),('Alyssa','Nguyen'),('Sam','Hill'),('Brooke','Flores'),
      ('Jake','Green'),('Morgan','Adams'),('Dylan','Nelson'),('Paige','Baker'),('Evan','Hall'),
      ('Courtney','Rivera'),('Blake','Campbell'),('Haley','Mitchell'),('Cody','Carter'),('Samantha','Roberts'),
      ('Brandon','Gomez'),('Jasmine','Murray'),('Victor','Freeman'),('Chloe','Wells'),('Marcus','Webb'),
      ('Isabella','Simpson'),('Jeff','Stevens'),('Natalie','Tucker'),('Patrick','Hunter'),('Zoe','Hicks'),
      ('Trevor','Crawford'),('Maya','Henry'),('Oscar','Boyd'),('Grace','Mason'),('Jared','Morales'),
      ('Leah','Kennedy'),('Collin','Warren'),('Aria','Dixon'),('Gavin','Ramos'),('Audrey','Reyes'),
      ('Tristan','Burns'),('Skylar','Gordon'),('Devin','Shaw'),('Lily','Holmes'),('Caleb','Rice'),
      ('Savannah','Robertson'),('Ian','Hunt'),('Stella','Black'),('Miles','Daniels'),('Peyton','Palmer'),
      ('Hunter','Mills'),('Violet','Nichols'),('Christian','Grant'),('Aurora','Knight'),('Connor','Ferguson'),
      ('Hazel','Stone'),('Jeremiah','Hawkins'),('Ellie','Dunn'),('Josiah','Perkins'),('Nova','Hudson'),
      ('Ezra','Spencer'),('Willow','Gardner'),('Asher','Stephens'),('Piper','Payne'),('Leo','Pierce'),
      ('Paisley','Berry'),('Luca','Matthews'),('Ruby','Arnold'),('Cooper','Wagner'),('Emery','Willis'),
      ('Eli','Watkins'),('Eva','Olson'),('Micah','Carroll'),('Madelyn','Duncan'),('Xavier','Snyder')
    ) AS t(first_name, last_name)
  )
  INSERT INTO subscribers (workspace_id, email, first_name, last_name, country, region, city, latitude, longitude, confirmed, unsubscribe_token, created_at)
  SELECT
    p_workspace_id,
    LOWER(c.first_name || '.' || c.last_name || s.row_num || '@demo.veloce.app'),
    c.first_name,
    c.last_name,
    'US',
    s.region,   -- (b) was s.city
    s.city,     -- (b) was s.region
    s.lat,
    s.lng,
    true,
    encode(gen_random_bytes(16), 'hex'),
    v_now - (random() * INTERVAL '90 days')
  FROM names c
  CROSS JOIN LATERAL (
    SELECT city, region, lat, lng, ROW_NUMBER() OVER () AS row_num
    FROM cities
    ORDER BY random()
    LIMIT 4
  ) s
  ORDER BY random()
  LIMIT 208;

  GET DIAGNOSTICS v_sub_count = ROW_COUNT;

  -- 3. Collect subscriber IDs
  SELECT array_agg(id) INTO v_subscriber_ids FROM subscribers WHERE workspace_id = p_workspace_id;

  -- 4. Create campaigns
  WITH camp_data AS (
    SELECT * FROM (VALUES
      ('Welcome to Veloce'::TEXT, 'Get started with audience ownership'::TEXT, 60::INT),
      ('Weekly Tech Roundup', 'This week''s best stories', 45),
      ('South Congress Sale', 'Your neighborhood deal is waiting', 30),
      ('Product Launch', 'Introducing our newest feature', 21),
      ('East Side Workshop', 'Learn something new this weekend', 14),
      ('Summer Campaign', 'Hot deals for the season', 7),
      ('Holiday Special', 'Limited-time holiday offer', 0)
    ) AS t(title, subject, days_ago)
  )
  INSERT INTO campaigns (workspace_id, title, subject, audience, status, editor_html, editor_css, plain_text, sent_count, last_sent_at, created_at, updated_at)
  SELECT
    p_workspace_id,
    cd.title,
    cd.subject,
    'confirmed',
    CASE WHEN cd.days_ago = 0 THEN 'draft' ELSE 'sent' END,
    '<p>This is a demo campaign. Real campaigns have HTML content written with the editor.</p>',
    '',
    'This is a demo campaign. Real campaigns have plain text content.',
    CASE WHEN cd.days_ago > 0 THEN floor(random() * 3000 + 200)::INT ELSE 0 END,
    CASE WHEN cd.days_ago > 0 THEN v_now - (cd.days_ago * INTERVAL '1 day') ELSE NULL END,
    v_now - (GREATEST(cd.days_ago, 1) * INTERVAL '1 day') - INTERVAL '7 days',
    v_now - (GREATEST(cd.days_ago, 1) * INTERVAL '1 day')
  FROM camp_data cd
  ORDER BY cd.days_ago DESC;

  GET DIAGNOSTICS v_camp_count = ROW_COUNT;

  -- 5. Generate campaign events (opens + clicks) for sent campaigns
  FOR v_campaign IN
    -- (a) was: (v_now - last_sent_at) AS age, an INTERVAL used below as a
    -- timestamp. Carry the timestamp itself.
    SELECT id, sent_count, last_sent_at AS sent_at
    FROM campaigns
    WHERE workspace_id = p_workspace_id AND status = 'sent'
  LOOP
    v_sent := v_campaign.sent_count;
    -- Realistic open rate: 25-55%
    v_open_rate := 0.25 + (random() * 0.30);
    v_opened := floor(v_sent * v_open_rate)::INT;
    -- Realistic click rate: 15-35% of opens
    v_click_rate := 0.15 + (random() * 0.20);
    v_clicked := floor(v_opened * v_click_rate)::INT;

    -- Generate opens: pick random subscribers who "opened"
    FOR v_hour IN 1..COALESCE(v_opened, 0) LOOP
      v_sub := (SELECT id FROM unnest(v_subscriber_ids) id ORDER BY random() LIMIT 1);
      -- Opens cluster during business hours (9am-5pm) in the days after send
      v_day_offset := floor(random() * 5)::INT;
      INSERT INTO campaign_events (workspace_id, campaign_id, subscriber_id, email, event_type, occurred_at)
      VALUES (
        p_workspace_id,
        v_campaign.id,
        v_sub.id,
        (SELECT email FROM subscribers WHERE id = v_sub.id),
        'open',
        v_campaign.sent_at + (v_day_offset * INTERVAL '1 day') + (INTERVAL '9 hours') + (random() * INTERVAL '8 hours')
      );
    END LOOP;

    -- Generate clicks: subset of opens, with a link URL
    FOR v_i IN 1..COALESCE(v_clicked, 0) LOOP
      v_sub := (SELECT id FROM unnest(v_subscriber_ids) id ORDER BY random() LIMIT 1);
      v_day_offset := floor(random() * 5)::INT;
      INSERT INTO campaign_events (workspace_id, campaign_id, subscriber_id, email, event_type, occurred_at, url)
      VALUES (
        p_workspace_id,
        v_campaign.id,
        v_sub.id,
        (SELECT email FROM subscribers WHERE id = v_sub.id),
        'click',
        v_campaign.sent_at + (v_day_offset * INTERVAL '1 day') + (INTERVAL '9 hours') + (random() * INTERVAL '8 hours'),
        'https://veloce.app/demo-link'
      );
    END LOOP;

    v_event_count := v_event_count + v_opened + v_clicked;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'subscribers', v_sub_count,
    'campaigns', v_camp_count,
    'events', v_event_count
  );
END;
$$;
