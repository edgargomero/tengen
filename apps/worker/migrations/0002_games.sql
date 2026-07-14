-- Fase 5 Task 2: tabla de partidas guardadas en la nube (D1 = fuente de verdad).
-- `opponent` (RankLevel JSON, solo mode='jugar'): el SGF no lleva oponente y sin él no se puede
-- reabrir una partida en Modo Jugar (decisión 4 del plan). `drive_file_id` se llena recién tras el
-- primer backup a Drive exitoso (Task 3). Timestamps en epoch ms (INTEGER), a diferencia de las
-- columnas date de better-auth (ISO strings): acá el SQL es nuestro y ORDER BY sobre enteros es
-- más barato y sin ambigüedad de parseo.
create table "games" (
  "id" text not null primary key,
  "user_id" text not null references "user" ("id") on delete cascade,
  "name" text not null,
  "sgf" text not null,
  "board_size" integer not null,
  "mode" text not null check ("mode" in ('jugar', 'analizar')),
  "result" text,
  "opponent" text,
  "drive_file_id" text,
  "created_at" integer not null,
  "updated_at" integer not null
);

-- "Mis partidas" lista por usuario ordenado por actividad reciente.
create index "games_user_updated_idx" on "games" ("user_id", "updated_at" desc);
