-- Add a fourth widget size: 'slim'.
--
-- 'small' already hides the headline and description, but it still renders as a
-- bordered card with the email field and button stacked, and the embed snippet
-- floors its iframe at 280px - so a one-field form reserved 280px of a host
-- page for roughly 100px of content. 'slim' is a single row: the email field
-- and the button side by side, no footer, sized to fit an inline strip.
--
-- Ordered smallest first wherever the list is presented, so the constraint is
-- rewritten rather than appended to.

ALTER TABLE widgets DROP CONSTRAINT IF EXISTS widgets_size_check;
ALTER TABLE widgets
  ADD CONSTRAINT widgets_size_check CHECK (size IN ('slim', 'small', 'medium', 'large'));
