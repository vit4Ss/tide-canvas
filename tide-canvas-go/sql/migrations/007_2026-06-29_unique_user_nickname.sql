-- Make user nicknames unique.
-- Existing duplicate nicknames are normalized before adding the unique index so
-- production databases can migrate without manual cleanup.

UPDATE sys_user
JOIN (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY nickname ORDER BY create_time, id) AS rn
    FROM sys_user
    WHERE deleted = 0 AND nickname IS NOT NULL AND TRIM(nickname) <> ''
) d ON d.id = sys_user.id
SET sys_user.nickname = CONCAT(LEFT(sys_user.nickname, 50), '_', d.rn)
WHERE d.rn > 1;

UPDATE sys_user
SET nickname = username
WHERE deleted = 0 AND (nickname IS NULL OR TRIM(nickname) = '');

ALTER TABLE sys_user
    ADD UNIQUE KEY uk_nickname (nickname);
