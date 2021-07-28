-- Functions

create function generate_snowflake(seq text, shard_id integer DEFAULT 1, OUT snowflake bigint) returns bigint
    language plpgsql
as
$$
DECLARE
    our_epoch  bigint := 1314220021721;
    seq_id     bigint;
    now_millis bigint;
    -- the id of this DB shard, must be set for each
    -- schema shard you have - you could pass this as a parameter too
    -- shard_id   int    := 1;
BEGIN
    SELECT nextval(seq) % 1024 INTO seq_id;

    SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000) INTO now_millis;
    snowflake := (now_millis - our_epoch) << 23;
    snowflake := snowflake | (shard_id << 10);
    snowflake := snowflake | (seq_id);
END;
$$;


-- Sequences

create sequence users_token_id_seq;
create sequence one_time_jwt_jti_seq;


-- Types

create type oauth_provider as enum ('GitHub', 'Microsoft', 'Google');

-- Tables

create table sessions
(
    sid    varchar      not null
        constraint sessions_pkey primary key,
    sess   json         not null,
    expire timestamp(6) not null
);
create index sessions_expire_idx on sessions (expire);

create table users
(
    id            bigserial
        constraint users_pk primary key,
    name          varchar(128)                                                   not null,
    admin         boolean default false                                          not null,
    token_id      bigint  default generate_snowflake('users_token_id_seq'::text) not null,
    storage_quota integer
);
comment on column users.storage_quota is 'in bytes';
create unique index users_token_id_uindex on users (token_id);

create table user_oauth
(
    user_id     integer        not null
        constraint user_oauth_users_id_fk references users,
    oauth_id    varchar(128)   not null,
    data        jsonb          not null,
    provider    oauth_provider not null,
    profile_img bytea,
    constraint user_oauth_pk primary key (user_id, provider)
);
create unique index user_oauth_oauth_id_uindex on user_oauth (oauth_id);

create table one_time_jwt
(
    jti     bigint  default generate_snowflake('one_time_jwt_jti_seq'::text) not null
        constraint jwt_invalidated_pk primary key,
    valid   boolean default true                                             not null,
    expires timestamp with time zone                                         not null
);
