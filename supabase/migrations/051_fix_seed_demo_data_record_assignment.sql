-- 051_fix_seed_demo_data_record_assignment.sql
--
-- seed_demo_data still could not complete after migration 050.
--
-- 050's header claims it fixed the "function could never complete" bug - the
-- INTERVAL built from (v_now - last_sent_at) being inserted into a TIMESTAMPTZ
-- column. That fix was real, but it was not the first thing to fail. Earlier in
-- the same loop:
--
--   v_sub RECORD;
--   ...
--   v_sub := (SELECT id FROM unnest(v_subscriber_ids) id ORDER BY random() LIMIT 1);
--
-- assigns a scalar uuid to a RECORD variable. PL/pgSQL raises
--
--   0A000: input of anonymous composite types is not implemented
--
-- on that line, before the cast bug is ever reached. It fires on the first
-- open-event iteration, and every seeded campaign has a non-zero sent_count, so
-- it fires on every call. Verified directly against this database with a
-- standalone DO block before writing this migration.
--
-- Fix: hold the subscriber id in a UUID variable instead of a RECORD, and pick
-- it by array subscript rather than an ORDER BY random() scan. The subscript is
-- both the simpler expression and O(1) - the previous form re-sorted all 208
-- ids for every one of the ~10k events a full seed generates.
--
-- SECOND FAULT, found by actually executing the function rather than reading it:
--
--   42804: column "unsubscribe_token" is of type uuid but expression is of type text
--
-- The subscriber insert supplies encode(gen_random_bytes(16), 'hex'), which is
-- text, to a uuid column. This is in step 2, so it aborts before either of the
-- other two faults is reached - meaning seed_demo_data has never completed a
-- single time, and 050's claim to have fixed it was made from reading the body,
-- not running it. The column is `uuid NOT NULL DEFAULT gen_random_uuid()`, so
-- the fix is to drop it from the insert entirely and let the default fire.
--
-- Every other column in all three inserts was checked against
-- information_schema.columns; there are no further type mismatches.
--
-- Nothing else in the function changes. The three fixes 050 made (the timestamp
-- base, the swapped region/city, the direct deletes) are preserved as-is.
--
-- Verified by running the function inside a transaction and rolling back.

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
  v_sub_id UUID;
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
  -- unsubscribe_token is omitted on purpose: it is uuid NOT NULL DEFAULT
  -- gen_random_uuid(), and the hex text this used to supply does not cast.
  INSERT INTO subscribers (workspace_id, email, first_name, last_name, country, region, city, latitude, longitude, confirmed, created_at)
  SELECT
    p_workspace_id,
    LOWER(c.first_name || '.' || c.last_name || s.row_num || '@demo.veloce.app'),
    c.first_name,
    c.last_name,
    'US',
    s.region,
    s.city,
    s.lat,
    s.lng,
    true,
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

  -- Nothing below can work without subscribers to attribute events to.
  IF v_subscriber_ids IS NULL OR array_length(v_subscriber_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'subscribers', v_sub_count,
      'campaigns', v_camp_count,
      'events', 0
    );
  END IF;

  -- 5. Generate campaign events (opens + clicks) for sent campaigns
  FOR v_campaign IN
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
      v_sub_id := v_subscriber_ids[1 + floor(random() * array_length(v_subscriber_ids, 1))::INT];
      -- Opens cluster during business hours (9am-5pm) in the days after send
      v_day_offset := floor(random() * 5)::INT;
      INSERT INTO campaign_events (workspace_id, campaign_id, subscriber_id, email, event_type, occurred_at)
      VALUES (
        p_workspace_id,
        v_campaign.id,
        v_sub_id,
        (SELECT email FROM subscribers WHERE id = v_sub_id),
        'open',
        v_campaign.sent_at + (v_day_offset * INTERVAL '1 day') + (INTERVAL '9 hours') + (random() * INTERVAL '8 hours')
      );
    END LOOP;

    -- Generate clicks: subset of opens, with a link URL
    FOR v_i IN 1..COALESCE(v_clicked, 0) LOOP
      v_sub_id := v_subscriber_ids[1 + floor(random() * array_length(v_subscriber_ids, 1))::INT];
      v_day_offset := floor(random() * 5)::INT;
      INSERT INTO campaign_events (workspace_id, campaign_id, subscriber_id, email, event_type, occurred_at, url)
      VALUES (
        p_workspace_id,
        v_campaign.id,
        v_sub_id,
        (SELECT email FROM subscribers WHERE id = v_sub_id),
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
