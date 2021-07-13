create table sessions
(
    sid    varchar      not null
        constraint sessions_pkey
            primary key,
    sess   json         not null,
    expire timestamp(6) not null
);

create index sessions_expire_idx
    on sessions (expire);

create table users
(
    id          serial      not null
        constraint users_pk
            primary key,
    github_id   bigint,
    github_data jsonb,
    name        varchar(64) not null
);

create unique index users_github_id_uindex
    on users (github_id);


