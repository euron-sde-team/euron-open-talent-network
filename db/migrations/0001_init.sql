-- Euron Open Talent: initial schema.
--
-- Conventions
--   * Primary keys are ULIDs stored as text (sortable by creation time).
--   * Timestamps are timestamptz(3), the API runs with TZ=UTC. Millisecond precision is
--     exactly what a JS Date holds, so a keyset cursor built from a Date round-trips
--     without skipping or repeating rows (microsecond columns would break that).
--   * Denormalised counters (follower_count, application_count, ...) are maintained in the
--     same transaction as the row they count, and a reconciliation job corrects any drift.
--   * Lists page with keyset cursors, never OFFSET.
--   * Private contact details live only on talent_profiles.contact_* and never leave the
--     API except through an unlocked, logged reveal (approach.service.ts: revealContact).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enums ──────────────────────────────────────────────────────────────────

-- RECRUITER_OPS reviews recruiter applications and companies; MODERATOR works the case
-- desk; ADMIN can do everything including settings and role changes.
CREATE TYPE user_role AS ENUM ('USER', 'MODERATOR', 'RECRUITER_OPS', 'ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED');
-- Who may start a message request with someone they are not connected to.
CREATE TYPE message_request_policy AS ENUM ('ANYONE', 'RECRUITERS', 'NOBODY');
CREATE TYPE auth_token_type AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TYPE upload_purpose AS ENUM (
  'POST', 'COMMENT', 'DM', 'AVATAR', 'COVER', 'COMPANY_LOGO', 'COMPANY_COVER',
  'PROJECT_COVER', 'RESUME', 'IMPORT', 'EVIDENCE'
);
CREATE TYPE upload_kind AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'PDF', 'DOCUMENT', 'OTHER');
CREATE TYPE upload_status AS ENUM ('PENDING', 'COMPLETE', 'READY', 'REJECTED', 'DELETED');

-- Lifecycle of any user-generated item. HIDDEN = taken down pending review or by a
-- moderator (restorable); REMOVED = moderator removal (final unless an appeal wins);
-- DELETED = the author deleted it.
CREATE TYPE content_status AS ENUM ('PUBLISHED', 'PENDING_REVIEW', 'HIDDEN', 'REMOVED', 'DELETED');
CREATE TYPE moderation_state AS ENUM ('UNCHECKED', 'CLEAN', 'REVIEW', 'FLAGGED');

CREATE TYPE profile_status AS ENUM ('DRAFT', 'PUBLISHED', 'UNLISTED', 'SUSPENDED');
-- OFF: no signal. RECRUITERS: only verified recruiters see it (and can filter on it).
-- PUBLIC: everyone sees the green ring.
CREATE TYPE open_to_work_mode AS ENUM ('OFF', 'RECRUITERS', 'PUBLIC');
CREATE TYPE employment_type AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP', 'TEMPORARY');
CREATE TYPE workplace_type AS ENUM ('ONSITE', 'HYBRID', 'REMOTE');
CREATE TYPE seniority AS ENUM ('INTERN', 'ENTRY', 'MID', 'SENIOR', 'LEAD', 'DIRECTOR', 'EXECUTIVE');
CREATE TYPE pay_period AS ENUM ('HOUR', 'DAY', 'MONTH', 'YEAR', 'PROJECT');
CREATE TYPE link_kind AS ENUM ('WEBSITE', 'GITHUB', 'LINKEDIN', 'X', 'YOUTUBE', 'MEDIUM', 'KAGGLE', 'HUGGINGFACE', 'BEHANCE', 'DRIBBBLE', 'OTHER');
CREATE TYPE badge_kind AS ENUM ('SENIORITY', 'ROLE_FIT', 'SKILL_PERCENTILE', 'DOMAIN', 'ACHIEVEMENT', 'VERIFICATION');
CREATE TYPE badge_source AS ENUM ('AI', 'SYSTEM', 'ADMIN');
CREATE TYPE import_source AS ENUM ('TEXT', 'FILE', 'AUDIO');
CREATE TYPE import_status AS ENUM ('QUEUED', 'EXTRACTING', 'GENERATING', 'SCORING', 'READY', 'APPLIED', 'FAILED');
CREATE TYPE contact_channel AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP');

CREATE TYPE company_status AS ENUM ('UNVERIFIED', 'VERIFIED', 'SUSPENDED');
CREATE TYPE company_role AS ENUM ('OWNER', 'ADMIN', 'RECRUITER');
-- EMAIL_PENDING: the work-email code has not been confirmed. PENDING_REVIEW: waiting in
-- the /admin approval queue. Only ACTIVE recruiters can search with recruiter filters,
-- send approaches, post jobs or see pipelines.
-- LEFT: the person left the company. The row stays, so the approaches, contact unlocks and
-- the candidate's contact access log that reference it are never lost.
CREATE TYPE recruiter_status AS ENUM ('EMAIL_PENDING', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'LEFT');

CREATE TYPE approach_status AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED', 'BLOCKED');
CREATE TYPE job_status AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'FILLED');
CREATE TYPE invite_status AS ENUM ('SENT', 'VIEWED', 'INTERESTED', 'DECLINED');
CREATE TYPE application_stage AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE application_source AS ENUM ('DIRECT', 'INVITE', 'APPROACH');

CREATE TYPE connection_status AS ENUM ('PENDING', 'ACCEPTED', 'IGNORED');
CREATE TYPE dm_participant_state AS ENUM ('ACTIVE', 'REQUESTED', 'DECLINED');
-- Why a thread exists; canMessage (domain/can-message.ts) decides which are allowed.
CREATE TYPE thread_context AS ENUM ('CONNECTION', 'APPROACH', 'APPLICATION', 'REQUEST', 'SUPPORT');

CREATE TYPE post_kind AS ENUM ('POST', 'HIRING', 'OPEN_TO_WORK', 'JOB', 'MILESTONE');
CREATE TYPE post_visibility AS ENUM ('PUBLIC', 'CONNECTIONS');
CREATE TYPE reaction_type AS ENUM ('LIKE', 'CELEBRATE', 'SUPPORT', 'INSIGHTFUL', 'LOVE', 'FUNNY');

CREATE TYPE engagement_status AS ENUM ('PROPOSED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'DISPUTED');
CREATE TYPE rating_direction AS ENUM ('RECRUITER_TO_CANDIDATE', 'CANDIDATE_TO_RECRUITER');
CREATE TYPE complaint_category AS ENUM ('HARASSMENT', 'NON_PAYMENT', 'NO_SHOW', 'MISREPRESENTATION', 'SPAM', 'SCAM', 'DISCRIMINATION', 'OTHER');
CREATE TYPE complaint_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACTION_TAKEN', 'DISMISSED');

CREATE TYPE notification_type AS ENUM (
  'CONNECTION_REQUEST', 'CONNECTION_ACCEPTED', 'FOLLOW', 'COMPANY_FOLLOW',
  'POST_COMMENT', 'COMMENT_REPLY', 'POST_REACTION', 'COMMENT_REACTION', 'MENTION', 'REPOST',
  'ENDORSEMENT', 'DM_REQUEST',
  'APPROACH_RECEIVED', 'APPROACH_ACCEPTED', 'APPROACH_DECLINED', 'CONTACT_REVOKED',
  'JOB_INVITE', 'APPLICATION_RECEIVED', 'APPLICATION_STAGE',
  'ENGAGEMENT_PROPOSED', 'ENGAGEMENT_UPDATED', 'RATING_RECEIVED',
  'RECRUITER_APPROVED', 'RECRUITER_REJECTED', 'IMPORT_READY',
  'COMPLAINT_UPDATED', 'MODERATION_ACTION', 'APPEAL_DECIDED'
);

CREATE TYPE moderation_target AS ENUM ('POST', 'COMMENT', 'DM_MESSAGE', 'USER', 'PROFILE', 'COMPANY', 'JOB', 'APPROACH');
CREATE TYPE report_reason AS ENUM ('SPAM', 'HARASSMENT', 'HATE', 'VIOLENCE', 'SEXUAL', 'SELF_HARM', 'MISINFORMATION', 'IMPERSONATION', 'SCAM', 'FAKE_PROFILE', 'OTHER');
CREATE TYPE case_source AS ENUM ('AI', 'REPORT', 'PREMODERATION');
CREATE TYPE case_status AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE moderation_action_type AS ENUM ('APPROVE', 'HIDE', 'REMOVE', 'RESTORE', 'WARN', 'SUSPEND', 'BAN', 'UNBAN', 'DISMISS');
CREATE TYPE appeal_status AS ENUM ('PENDING', 'UPHELD', 'OVERTURNED');

-- ─── Identity ───────────────────────────────────────────────────────────────

CREATE TABLE media_uploads (
  id               text PRIMARY KEY,
  owner_id         text NOT NULL,            -- FK added after users exists
  purpose          upload_purpose NOT NULL,
  kind             upload_kind NOT NULL,
  mime_type        text NOT NULL,
  file_name        text NOT NULL,
  declared_size    bigint NOT NULL,
  size_bytes       bigint,
  storage_key      text NOT NULL UNIQUE,
  thumb_key        text,
  width            integer,
  height           integer,
  duration_seconds integer,
  status           upload_status NOT NULL DEFAULT 'PENDING',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  rejected_reason  text,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  completed_at     timestamptz(3)
);
CREATE INDEX media_uploads_owner_idx ON media_uploads (owner_id, created_at DESC);
CREATE INDEX media_uploads_pending_idx ON media_uploads (created_at) WHERE status = 'PENDING';

CREATE TABLE users (
  id                     text PRIMARY KEY,
  email                  citext NOT NULL UNIQUE,
  username               citext NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9-]{1,38}[a-zA-Z0-9]$'),
  -- Cleaned at write time (domain/display-name.ts): never an email address or a phone number.
  display_name           text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  password_hash          text NOT NULL,
  role                   user_role NOT NULL DEFAULT 'USER',
  status                 user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at      timestamptz(3),
  totp_secret            text,                    -- AES-256-GCM ciphertext (security/totp.ts), never the raw secret
  totp_enabled           boolean NOT NULL DEFAULT false,
  totp_last_step         bigint,                  -- last accepted TOTP time step: a code works once
  suspended_until        timestamptz(3),
  token_version          integer NOT NULL DEFAULT 0,
  avatar_upload_id       text REFERENCES media_uploads (id) ON DELETE SET NULL,
  cover_upload_id        text REFERENCES media_uploads (id) ON DELETE SET NULL,
  message_request_policy message_request_policy NOT NULL DEFAULT 'RECRUITERS',
  email_digest           boolean NOT NULL DEFAULT true,   -- "while you were away" emails; the user can opt out
  connection_count       integer NOT NULL DEFAULT 0,
  follower_count         integer NOT NULL DEFAULT 0,
  following_count        integer NOT NULL DEFAULT 0,
  post_count             integer NOT NULL DEFAULT 0,
  last_seen_at           timestamptz(3),
  created_at             timestamptz(3) NOT NULL DEFAULT now(),
  updated_at             timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX users_name_trgm_idx ON users USING gin ((display_name || ' ' || username::text) gin_trgm_ops);

ALTER TABLE media_uploads ADD CONSTRAINT media_uploads_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    text NOT NULL,                  -- every rotation of one login shares a family
  token_hash   text NOT NULL UNIQUE,           -- sha256 of the refresh token
  user_agent   text,
  ip           inet,
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  last_used_at timestamptz(3) NOT NULL DEFAULT now(),
  expires_at   timestamptz(3) NOT NULL,
  revoked_at   timestamptz(3),
  replaced_by  text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id);

CREATE TABLE auth_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       auth_token_type NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, type);

-- Single-use two-factor recovery codes, issued ten at a time when TOTP is turned on.
-- Only an HMAC of each code is stored (keyed from TOTP_ENCRYPTION_KEY).
CREATE TABLE totp_recovery_codes (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash  text NOT NULL,
  used_at    timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

-- A renamed handle keeps resolving: /in/<old> redirects to the current username.
CREATE TABLE username_history (
  old_username citext PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX username_history_user_idx ON username_history (user_id, created_at DESC);

-- ─── Network graph ──────────────────────────────────────────────────────────

-- One row per pair. pair_key = "<lowerId>:<higherId>" makes A->B and B->A the same row,
-- so two people requesting each other at once cannot create two connections.
CREATE TABLE connections (
  id           text PRIMARY KEY,
  pair_key     text NOT NULL UNIQUE,
  requester_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  addressee_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status       connection_status NOT NULL DEFAULT 'PENDING',
  note         text CHECK (length(note) <= 300),
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  responded_at timestamptz(3),
  CHECK (requester_id <> addressee_id)
);
CREATE INDEX connections_requester_idx ON connections (requester_id, status);
CREATE INDEX connections_addressee_idx ON connections (addressee_id, status, created_at DESC);

CREATE TABLE follows (
  follower_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

-- A block is one-directional in storage and symmetric in effect: every visibility
-- query checks both directions (see repositories/visibility.ts).
CREATE TABLE blocks (
  blocker_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- ─── Talent profile ─────────────────────────────────────────────────────────

-- Every account has exactly one profile row (created with the account, DRAFT). The
-- status decides whether the public page and directory listing exist; the member card
-- (name, headline, avatar) is always visible to signed-in members.
CREATE TABLE talent_profiles (
  id                 text PRIMARY KEY,
  user_id            text NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  status             profile_status NOT NULL DEFAULT 'DRAFT',
  headline           text CHECK (length(headline) <= 160),
  about              text CHECK (length(about) <= 4000),
  current_title      text CHECK (length(current_title) <= 120),
  current_company    text CHECK (length(current_company) <= 120),
  location           text CHECK (length(location) <= 120),
  country_code       char(2),
  timezone           text CHECK (length(timezone) <= 64),
  years_experience   smallint CHECK (years_experience BETWEEN 0 AND 70),
  languages          text[] NOT NULL DEFAULT '{}',
  open_to_work       open_to_work_mode NOT NULL DEFAULT 'OFF',
  open_to_roles      text[] NOT NULL DEFAULT '{}',
  employment_types   employment_type[] NOT NULL DEFAULT '{}',
  workplace_types    workplace_type[] NOT NULL DEFAULT '{}',
  available_from     date,
  rate_min           integer CHECK (rate_min >= 0),
  rate_max           integer CHECK (rate_max >= 0),
  rate_currency      char(3),
  rate_period        pay_period,
  -- Private. Revealed per channel only through contact_unlocks.
  contact_email      citext,
  contact_phone      text CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  whatsapp_phone     text CHECK (whatsapp_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- { "experience": "PUBLIC" | "CONNECTIONS" | "RECRUITERS", ... } (domain/profile.ts)
  section_visibility jsonb NOT NULL DEFAULT '{}',
  completeness       smallint NOT NULL DEFAULT 0,
  rating_avg         numeric(3, 2),
  rating_count       integer NOT NULL DEFAULT 0,
  view_count         integer NOT NULL DEFAULT 0,
  approach_count     integer NOT NULL DEFAULT 0,
  suspended_reason   text CHECK (length(suspended_reason) <= 500),
  published_at       timestamptz(3),
  -- Denormalised text from the sections, rebuilt whenever a section is saved.
  search_text        text NOT NULL DEFAULT '',
  skill_names        citext[] NOT NULL DEFAULT '{}',
  created_at         timestamptz(3) NOT NULL DEFAULT now(),
  updated_at         timestamptz(3) NOT NULL DEFAULT now(),
  search             tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(headline, '') || ' ' || coalesce(current_title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(location, '') || ' ' || coalesce(current_company, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(about, '') || ' ' || search_text), 'C')
  ) STORED,
  CHECK (rate_max IS NULL OR rate_min IS NULL OR rate_max >= rate_min)
);
CREATE INDEX talent_profiles_search_idx ON talent_profiles USING gin (search);
CREATE INDEX talent_profiles_skills_idx ON talent_profiles USING gin (skill_names);
CREATE INDEX talent_profiles_directory_idx ON talent_profiles (published_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX talent_profiles_location_trgm_idx ON talent_profiles USING gin (location gin_trgm_ops);

CREATE TABLE profile_experiences (
  id              text PRIMARY KEY,
  profile_id      text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  company_name    text NOT NULL CHECK (length(company_name) BETWEEN 1 AND 120),
  company_id      text,                          -- FK added after companies exists
  employment_type employment_type,
  workplace_type  workplace_type,
  location        text CHECK (length(location) <= 120),
  start_month     date NOT NULL,                 -- always the 1st of the month
  end_month       date,                          -- NULL = current role
  description     text CHECK (length(description) <= 3000),
  skills          text[] NOT NULL DEFAULT '{}',
  position        smallint NOT NULL,
  CHECK (end_month IS NULL OR end_month >= start_month)
);
CREATE INDEX profile_experiences_profile_idx ON profile_experiences (profile_id, position);

CREATE TABLE profile_educations (
  id          text PRIMARY KEY,
  profile_id  text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  institution text NOT NULL CHECK (length(institution) BETWEEN 1 AND 160),
  degree      text CHECK (length(degree) <= 120),
  field       text CHECK (length(field) <= 120),
  start_year  smallint CHECK (start_year BETWEEN 1900 AND 2100),
  end_year    smallint CHECK (end_year BETWEEN 1900 AND 2100),
  grade       text CHECK (length(grade) <= 40),
  description text CHECK (length(description) <= 2000),
  position    smallint NOT NULL
);
CREATE INDEX profile_educations_profile_idx ON profile_educations (profile_id, position);

CREATE TABLE profile_projects (
  id              text PRIMARY KEY,
  profile_id      text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description     text CHECK (length(description) <= 3000),
  url             text CHECK (length(url) <= 500),
  repo_url        text CHECK (length(repo_url) <= 500),
  cover_upload_id text REFERENCES media_uploads (id) ON DELETE SET NULL,
  skills          text[] NOT NULL DEFAULT '{}',
  start_month     date,
  end_month       date,
  position        smallint NOT NULL
);
CREATE INDEX profile_projects_profile_idx ON profile_projects (profile_id, position);

CREATE TABLE profile_skills (
  id                text PRIMARY KEY,
  profile_id        text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  name              citext NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  category          text CHECK (length(category) <= 60),
  years             smallint CHECK (years BETWEEN 0 AND 60),
  endorsement_count integer NOT NULL DEFAULT 0,
  position          smallint NOT NULL,
  UNIQUE (profile_id, name)
);

-- Only connections can endorse; one endorsement per skill per person.
CREATE TABLE skill_endorsements (
  skill_id    text NOT NULL REFERENCES profile_skills (id) ON DELETE CASCADE,
  endorser_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, endorser_id)
);
CREATE INDEX skill_endorsements_endorser_idx ON skill_endorsements (endorser_id);

CREATE TABLE profile_certifications (
  id             text PRIMARY KEY,
  profile_id     text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  issuer         text CHECK (length(issuer) <= 120),
  issued_month   date,
  expires_month  date,
  credential_id  text CHECK (length(credential_id) <= 120),
  credential_url text CHECK (length(credential_url) <= 500),
  position       smallint NOT NULL
);
CREATE INDEX profile_certifications_profile_idx ON profile_certifications (profile_id, position);

CREATE TABLE profile_links (
  id         text PRIMARY KEY,
  profile_id text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  kind       link_kind NOT NULL,
  url        text NOT NULL CHECK (length(url) <= 500),
  label      text CHECK (length(label) <= 80),
  featured   boolean NOT NULL DEFAULT false,   -- shown in the Featured strip (YouTube embeds click-to-load)
  position   smallint NOT NULL
);
CREATE INDEX profile_links_profile_idx ON profile_links (profile_id, position);

CREATE TABLE profile_badges (
  id             text PRIMARY KEY,
  profile_id     text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  kind           badge_kind NOT NULL,
  source         badge_source NOT NULL,
  slug           text NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,80}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  rationale      text CHECK (length(rationale) <= 500),
  evidence_quote text CHECK (length(evidence_quote) <= 500),
  confidence     numeric(3, 2),
  percentile     smallint CHECK (percentile BETWEEN 0 AND 100),
  is_visible     boolean NOT NULL DEFAULT true,
  granted_by     text REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (profile_id, slug)
);

-- AI import: text, a file or a voice note becomes a proposed profile the owner reviews.
-- The raw input and the extracted personal details are purged once applied (or after
-- import.retentionHours): see jobs/talent.jobs.ts and services/housekeeping.service.ts.
CREATE TABLE profile_imports (
  id              text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source          import_source NOT NULL,
  status          import_status NOT NULL DEFAULT 'QUEUED',
  upload_id       text REFERENCES media_uploads (id) ON DELETE SET NULL,
  input_text      text CHECK (length(input_text) <= 30000),
  extracted       jsonb,
  proposed_badges jsonb,
  missing_info    text[] NOT NULL DEFAULT '{}',
  error           text,
  provider        text,
  model           text,
  tokens_in       integer,
  tokens_out      integer,
  applied_at      timestamptz(3),
  purged_at       timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX profile_imports_user_idx ON profile_imports (user_id, created_at DESC);
CREATE INDEX profile_imports_purge_idx ON profile_imports (created_at) WHERE purged_at IS NULL;

-- One row per viewer per profile per day: refreshing the page does not inflate counts.
-- viewer_key is the user id, or a salted hash of the IP for signed-out visitors.
CREATE TABLE profile_views (
  profile_id      text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  viewer_key      text NOT NULL,
  day             date NOT NULL,
  viewer_id       text REFERENCES users (id) ON DELETE SET NULL,
  viewer_company  text,                           -- set when the viewer is an active recruiter
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, viewer_key, day)
);
CREATE INDEX profile_views_recent_idx ON profile_views (profile_id, created_at DESC);

CREATE TABLE resume_exports (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  format     text NOT NULL CHECK (format IN ('PDF', 'DOCX')),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX resume_exports_recent_idx ON resume_exports (created_at DESC);

-- ─── Companies and recruiters ───────────────────────────────────────────────

CREATE TABLE companies (
  id                  text PRIMARY KEY,
  slug                citext NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  name                text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  tagline             text CHECK (length(tagline) <= 160),
  about               text CHECK (length(about) <= 4000),
  website             text CHECK (length(website) <= 300),
  industry            text CHECK (length(industry) <= 80),
  size_band           text CHECK (size_band IN ('1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+')),
  headquarters        text CHECK (length(headquarters) <= 120),
  founded_year        smallint CHECK (founded_year BETWEEN 1800 AND 2100),
  -- Work-email domains that prove membership, e.g. {northwind.example}.
  domains             citext[] NOT NULL DEFAULT '{}',
  -- When true, a recruiter whose confirmed work email matches a domain of a VERIFIED
  -- company skips the review queue.
  auto_approve_domain boolean NOT NULL DEFAULT false,
  logo_upload_id      text REFERENCES media_uploads (id) ON DELETE SET NULL,
  cover_upload_id     text REFERENCES media_uploads (id) ON DELETE SET NULL,
  status              company_status NOT NULL DEFAULT 'UNVERIFIED',
  verified_at         timestamptz(3),
  verified_by         text REFERENCES users (id) ON DELETE SET NULL,
  suspended_reason    text CHECK (length(suspended_reason) <= 500),
  follower_count      integer NOT NULL DEFAULT 0,
  member_count        integer NOT NULL DEFAULT 0,
  open_job_count      integer NOT NULL DEFAULT 0,
  rating_avg          numeric(3, 2),
  rating_count        integer NOT NULL DEFAULT 0,
  created_by          text REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  updated_at          timestamptz(3) NOT NULL DEFAULT now(),
  search              tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', name), 'A') ||
    setweight(to_tsvector('simple', coalesce(tagline, '') || ' ' || coalesce(industry, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(about, '')), 'C')
  ) STORED
);
CREATE INDEX companies_search_idx ON companies USING gin (search);
CREATE INDEX companies_name_trgm_idx ON companies USING gin (name gin_trgm_ops);
CREATE INDEX companies_domains_idx ON companies USING gin (domains);

ALTER TABLE profile_experiences ADD CONSTRAINT profile_experiences_company_fk FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE SET NULL;

CREATE TABLE company_follows (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX company_follows_company_idx ON company_follows (company_id);

-- A user recruits for at most one company at a time (UNIQUE user_id). The row is both
-- the team membership and the verification record.
CREATE TABLE recruiters (
  id                     text PRIMARY KEY,
  user_id                text NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  company_id             text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  role                   company_role NOT NULL DEFAULT 'RECRUITER',
  status                 recruiter_status NOT NULL DEFAULT 'EMAIL_PENDING',
  title                  text CHECK (length(title) <= 120),
  work_email             citext NOT NULL UNIQUE,
  work_email_verified_at timestamptz(3),
  phone                  text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_verified_at      timestamptz(3),
  application_note       text CHECK (length(application_note) <= 1000),
  review_note            text CHECK (length(review_note) <= 1000),
  reviewed_by            text REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at            timestamptz(3),
  -- NULL = the platform default from settings (recruiter.approachesPerDay).
  approach_quota_daily   smallint CHECK (approach_quota_daily BETWEEN 0 AND 1000),
  suspended_reason       text CHECK (length(suspended_reason) <= 500),
  approaches_sent        integer NOT NULL DEFAULT 0,
  created_at             timestamptz(3) NOT NULL DEFAULT now(),
  updated_at             timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX recruiters_company_idx ON recruiters (company_id, status);
CREATE INDEX recruiters_review_idx ON recruiters (created_at) WHERE status = 'PENDING_REVIEW';

-- Work-email one-time codes. Only an HMAC of the code is stored; attempts are counted
-- with an atomic UPDATE ... RETURNING so parallel guesses cannot exceed the cap.
CREATE TABLE recruiter_email_codes (
  id           text PRIMARY KEY,
  recruiter_id text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  email        citext NOT NULL,
  code_hash    text NOT NULL,
  attempts     smallint NOT NULL DEFAULT 0,
  expires_at   timestamptz(3) NOT NULL,
  consumed_at  timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX recruiter_email_codes_recruiter_idx ON recruiter_email_codes (recruiter_id, created_at DESC);

CREATE TABLE saved_candidates (
  recruiter_id text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  profile_id   text NOT NULL REFERENCES talent_profiles (id) ON DELETE CASCADE,
  note         text CHECK (length(note) <= 500),
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (recruiter_id, profile_id)
);
CREATE INDEX saved_candidates_list_idx ON saved_candidates (recruiter_id, created_at DESC);

CREATE TABLE saved_searches (
  id           text PRIMARY KEY,
  recruiter_id text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  query        jsonb NOT NULL,
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX saved_searches_recruiter_idx ON saved_searches (recruiter_id, created_at DESC);

-- ─── Direct messages ────────────────────────────────────────────────────────

-- 1:1 threads only. direct_key = "<lowerId>:<higherId>" makes find-or-create race-free.
CREATE TABLE dm_threads (
  id              text PRIMARY KEY,
  direct_key      text NOT NULL UNIQUE,
  context         thread_context NOT NULL,
  context_id      text,                         -- the approach or application that opened it
  created_by      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  last_message_at timestamptz(3),
  created_at      timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE dm_participants (
  thread_id    text NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- REQUESTED: a message request the recipient has not accepted yet. The sender can
  -- write (up to the request cap); the recipient sees it under "Requests", no push.
  state        dm_participant_state NOT NULL DEFAULT 'ACTIVE',
  last_read_at timestamptz(3),
  muted_until  timestamptz(3),
  archived_at  timestamptz(3),
  joined_at    timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);
CREATE INDEX dm_participants_user_idx ON dm_participants (user_id, state);

CREATE TABLE dm_messages (
  id               text PRIMARY KEY,
  thread_id        text NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  sender_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 8000),
  reply_to_id      text REFERENCES dm_messages (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX dm_messages_thread_idx ON dm_messages (thread_id, created_at DESC, id DESC);

CREATE TABLE dm_message_media (
  message_id text NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  upload_id  text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position   smallint NOT NULL,
  PRIMARY KEY (message_id, upload_id)
);

CREATE TABLE dm_reactions (
  message_id text NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji      text NOT NULL CHECK (length(emoji) BETWEEN 1 AND 16),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ─── Approaches and contact consent ─────────────────────────────────────────

-- A recruiter's structured outreach. The candidate accepts by choosing which contact
-- channels to share; that creates a contact_unlock and opens a DM thread.
CREATE TABLE approaches (
  id               text PRIMARY KEY,
  recruiter_id     text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  company_id       text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  candidate_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id           text,                         -- FK added after jobs exists
  role_title       text NOT NULL CHECK (length(role_title) BETWEEN 2 AND 120),
  message          text NOT NULL CHECK (length(message) BETWEEN 30 AND 3000),
  employment_type  employment_type,
  salary_min       integer CHECK (salary_min >= 0),
  salary_max       integer CHECK (salary_max >= 0),
  salary_currency  char(3),
  pay_period       pay_period,
  status           approach_status NOT NULL DEFAULT 'PENDING',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  decline_reason   text CHECK (length(decline_reason) <= 500),
  thread_id        text REFERENCES dm_threads (id) ON DELETE SET NULL,
  viewed_at        timestamptz(3),
  responded_at     timestamptz(3),
  expires_at       timestamptz(3) NOT NULL,
  created_at       timestamptz(3) NOT NULL DEFAULT now()
);
-- One pending approach per recruiter and candidate.
CREATE UNIQUE INDEX approaches_pending_pair_idx ON approaches (recruiter_id, candidate_id) WHERE status = 'PENDING';
CREATE INDEX approaches_candidate_idx ON approaches (candidate_id, created_at DESC, id DESC);
CREATE INDEX approaches_recruiter_idx ON approaches (recruiter_id, created_at DESC, id DESC);
CREATE INDEX approaches_expiry_idx ON approaches (expires_at) WHERE status = 'PENDING';

CREATE TABLE contact_unlocks (
  id             text PRIMARY KEY,
  approach_id    text NOT NULL UNIQUE REFERENCES approaches (id) ON DELETE CASCADE,
  recruiter_id   text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  candidate_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channels       contact_channel[] NOT NULL CHECK (cardinality(channels) > 0),
  revoked_at     timestamptz(3),
  revoked_reason text CHECK (length(revoked_reason) <= 300),
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX contact_unlocks_candidate_idx ON contact_unlocks (candidate_id) WHERE revoked_at IS NULL;

-- Every reveal of a contact detail, shown to the candidate ("Who has seen your details").
CREATE TABLE contact_access_log (
  id           text PRIMARY KEY,
  unlock_id    text NOT NULL REFERENCES contact_unlocks (id) ON DELETE CASCADE,
  recruiter_id text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel      contact_channel NOT NULL,
  ip_hash      text,
  user_agent   text CHECK (length(user_agent) <= 300),
  viewed_at    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX contact_access_log_candidate_idx ON contact_access_log (candidate_id, viewed_at DESC);

-- ─── Jobs and applications ──────────────────────────────────────────────────

CREATE TABLE jobs (
  id                  text PRIMARY KEY,
  company_id          text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  posted_by           text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description         text NOT NULL CHECK (length(description) BETWEEN 30 AND 12000),
  employment_type     employment_type NOT NULL,
  workplace_type      workplace_type NOT NULL,
  seniority           seniority,
  location            text CHECK (length(location) <= 120),
  country_code        char(2),
  salary_min          integer CHECK (salary_min >= 0),
  salary_max          integer CHECK (salary_max >= 0),
  salary_currency     char(3),
  pay_period          pay_period,
  skills              citext[] NOT NULL DEFAULT '{}',
  openings            smallint NOT NULL DEFAULT 1 CHECK (openings BETWEEN 1 AND 500),
  -- [{ id, prompt, kind: "TEXT" | "YES_NO", required }] (domain/screening.ts)
  screening_questions jsonb NOT NULL DEFAULT '[]',
  status              job_status NOT NULL DEFAULT 'DRAFT',
  content_status      content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state    moderation_state NOT NULL DEFAULT 'UNCHECKED',
  application_count   integer NOT NULL DEFAULT 0,
  view_count          integer NOT NULL DEFAULT 0,
  opened_at           timestamptz(3),
  closes_at           timestamptz(3),
  closed_at           timestamptz(3),
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  updated_at          timestamptz(3) NOT NULL DEFAULT now(),
  search              tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', title), 'A') ||
    setweight(to_tsvector('simple', coalesce(location, '')), 'B') ||
    setweight(to_tsvector('simple', description), 'C')
  ) STORED,
  CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min)
);
CREATE INDEX jobs_search_idx ON jobs USING gin (search);
CREATE INDEX jobs_skills_idx ON jobs USING gin (skills);
CREATE INDEX jobs_open_idx ON jobs (opened_at DESC, id DESC) WHERE status = 'OPEN' AND content_status = 'PUBLISHED';
CREATE INDEX jobs_company_idx ON jobs (company_id, status, created_at DESC);
CREATE INDEX jobs_title_trgm_idx ON jobs USING gin (title gin_trgm_ops);

ALTER TABLE approaches ADD CONSTRAINT approaches_job_fk FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE SET NULL;

CREATE TABLE saved_jobs (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id     text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);
CREATE INDEX saved_jobs_list_idx ON saved_jobs (user_id, created_at DESC);

CREATE TABLE job_invites (
  id           text PRIMARY KEY,
  job_id       text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  invited_by   text NOT NULL REFERENCES recruiters (id) ON DELETE CASCADE,
  message      text CHECK (length(message) <= 1000),
  status       invite_status NOT NULL DEFAULT 'SENT',
  responded_at timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);
CREATE INDEX job_invites_candidate_idx ON job_invites (candidate_id, created_at DESC);

CREATE TABLE applications (
  id               text PRIMARY KEY,
  job_id           text NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  company_id       text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  candidate_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source           application_source NOT NULL DEFAULT 'DIRECT',
  -- The profile as it was when they applied (headline, experience, skills): the
  -- recruiter reviews what the candidate submitted, even if the profile changes later.
  profile_snapshot jsonb NOT NULL,
  resume_upload_id text REFERENCES media_uploads (id) ON DELETE SET NULL,
  cover_note       text CHECK (length(cover_note) <= 3000),
  answers          jsonb NOT NULL DEFAULT '[]',   -- [{ questionId, answer }]
  stage            application_stage NOT NULL DEFAULT 'APPLIED',
  rejection_reason text CHECK (length(rejection_reason) <= 500),
  match_score      smallint CHECK (match_score BETWEEN 0 AND 100),
  match_detail     jsonb,
  thread_id        text REFERENCES dm_threads (id) ON DELETE SET NULL,
  stage_changed_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (job_id, candidate_id)
);
CREATE INDEX applications_pipeline_idx ON applications (job_id, stage, stage_changed_at DESC);
CREATE INDEX applications_candidate_idx ON applications (candidate_id, created_at DESC, id DESC);

-- The status timeline the candidate sees, and the pipeline history the team sees.
CREATE TABLE application_events (
  id             text PRIMARY KEY,
  application_id text NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  actor_id       text REFERENCES users (id) ON DELETE SET NULL,
  from_stage     application_stage,
  to_stage       application_stage NOT NULL,
  -- Team-only context; the candidate sees the stage and time, never the note.
  note           text CHECK (length(note) <= 1000),
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX application_events_app_idx ON application_events (application_id, created_at);

-- Private notes a hiring team keeps about a candidate (optionally on one application).
CREATE TABLE candidate_notes (
  id             text PRIMARY KEY,
  company_id     text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  candidate_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  application_id text REFERENCES applications (id) ON DELETE CASCADE,
  author_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 3000),
  rating         smallint CHECK (rating BETWEEN 1 AND 5),
  created_at     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX candidate_notes_lookup_idx ON candidate_notes (company_id, candidate_id, created_at DESC);

-- ─── Feed ───────────────────────────────────────────────────────────────────

CREATE TABLE posts (
  id               text PRIMARY KEY,
  author_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Set when a company admin posts as the company page.
  company_id       text REFERENCES companies (id) ON DELETE CASCADE,
  kind             post_kind NOT NULL DEFAULT 'POST',
  visibility       post_visibility NOT NULL DEFAULT 'PUBLIC',
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 6000),
  job_id           text REFERENCES jobs (id) ON DELETE SET NULL,
  shared_post_id   text REFERENCES posts (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  reaction_count   integer NOT NULL DEFAULT 0,
  reaction_counts  jsonb NOT NULL DEFAULT '{}',   -- { "LIKE": 3, "CELEBRATE": 1 }
  comment_count    integer NOT NULL DEFAULT 0,
  repost_count     integer NOT NULL DEFAULT 0,
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC, id DESC);
CREATE INDEX posts_company_idx ON posts (company_id, created_at DESC, id DESC) WHERE company_id IS NOT NULL;
CREATE INDEX posts_feed_idx ON posts (created_at DESC, id DESC) WHERE status = 'PUBLISHED';
CREATE INDEX posts_search_idx ON posts USING gin (search);

CREATE TABLE post_media (
  post_id   text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  upload_id text NOT NULL REFERENCES media_uploads (id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  PRIMARY KEY (post_id, upload_id)
);
CREATE INDEX post_media_upload_idx ON post_media (upload_id);

CREATE TABLE post_mentions (
  post_id text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_reactions (
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       reaction_type NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_reactions_user_idx ON post_reactions (user_id, created_at DESC);

CREATE TABLE post_bookmarks (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX post_bookmarks_feed_idx ON post_bookmarks (user_id, created_at DESC);

-- "Not interested" on your own feed (not moderation).
CREATE TABLE post_hides (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id    text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE comments (
  id               text PRIMARY KEY,
  post_id          text NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  author_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  parent_id        text REFERENCES comments (id) ON DELETE CASCADE,
  body             text NOT NULL CHECK (length(body) <= 4000),
  upload_id        text REFERENCES media_uploads (id) ON DELETE SET NULL,
  status           content_status NOT NULL DEFAULT 'PUBLISHED',
  moderation_state moderation_state NOT NULL DEFAULT 'UNCHECKED',
  reply_count      integer NOT NULL DEFAULT 0,
  reaction_count   integer NOT NULL DEFAULT 0,
  reaction_counts  jsonb NOT NULL DEFAULT '{}',
  edited_at        timestamptz(3),
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_at       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at, id) WHERE parent_id IS NULL;
CREATE INDEX comments_parent_idx ON comments (parent_id, created_at, id) WHERE parent_id IS NOT NULL;
CREATE INDEX comments_author_idx ON comments (author_id, created_at DESC);

CREATE TABLE comment_mentions (
  comment_id text NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE comment_reactions (
  comment_id text NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       reaction_type NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ─── Trust: engagements, ratings, complaints ────────────────────────────────

-- Work that came out of an accepted approach or a hire. Both sides confirm the start;
-- either side can mark it complete, and the other confirms or disputes within the
-- confirmation window (settings: trust.autoConfirmDays) before ratings open.
CREATE TABLE engagements (
  id                      text PRIMARY KEY,
  approach_id             text UNIQUE REFERENCES approaches (id) ON DELETE SET NULL,
  application_id          text UNIQUE REFERENCES applications (id) ON DELETE SET NULL,
  company_id              text NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  recruiter_user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  candidate_id            text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title                   text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  status                  engagement_status NOT NULL DEFAULT 'PROPOSED',
  proposed_by             text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  candidate_confirmed_at  timestamptz(3),
  recruiter_confirmed_at  timestamptz(3),
  completion_requested_by text REFERENCES users (id) ON DELETE SET NULL,
  completion_requested_at timestamptz(3),
  completed_at            timestamptz(3),
  disputed_at             timestamptz(3),
  created_at              timestamptz(3) NOT NULL DEFAULT now(),
  updated_at              timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (approach_id IS NOT NULL OR application_id IS NOT NULL)
);
CREATE INDEX engagements_candidate_idx ON engagements (candidate_id, created_at DESC);
CREATE INDEX engagements_recruiter_idx ON engagements (recruiter_user_id, created_at DESC);
CREATE INDEX engagements_autoconfirm_idx ON engagements (completion_requested_at) WHERE status = 'ACTIVE' AND completion_requested_at IS NOT NULL;

-- Double-blind: a rating is hidden until both sides have rated or the window closes;
-- after it is revealed it can no longer be edited (no retaliation).
CREATE TABLE ratings (
  id            text PRIMARY KEY,
  engagement_id text NOT NULL REFERENCES engagements (id) ON DELETE CASCADE,
  direction     rating_direction NOT NULL,
  rater_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ratee_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score         smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  -- { communication, quality, reliability, professionalism }: each 1..5 (domain/trust.ts)
  sub_scores    jsonb NOT NULL DEFAULT '{}',
  comment       text CHECK (length(comment) <= 1000),
  revealed_at   timestamptz(3),
  hidden_at     timestamptz(3),
  hidden_reason text CHECK (length(hidden_reason) <= 300),
  edited_at     timestamptz(3),
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, direction)
);
CREATE INDEX ratings_ratee_idx ON ratings (ratee_id, revealed_at DESC) WHERE revealed_at IS NOT NULL AND hidden_at IS NULL;

CREATE TABLE complaints (
  id                  text PRIMARY KEY,
  complainant_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  against_user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  engagement_id       text REFERENCES engagements (id) ON DELETE SET NULL,
  approach_id         text REFERENCES approaches (id) ON DELETE SET NULL,
  application_id      text REFERENCES applications (id) ON DELETE SET NULL,
  category            complaint_category NOT NULL,
  description         text NOT NULL CHECK (length(description) BETWEEN 20 AND 3000),
  evidence_upload_ids text[] NOT NULL DEFAULT '{}',
  status              complaint_status NOT NULL DEFAULT 'OPEN',
  admin_note          text CHECK (length(admin_note) <= 1000),
  -- The enforcement taken, if any (moderation_actions row).
  action_id           text,
  resolved_by         text REFERENCES users (id) ON DELETE SET NULL,
  resolved_at         timestamptz(3),
  created_at          timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (complainant_id <> against_user_id)
);
CREATE INDEX complaints_queue_idx ON complaints (status, created_at);
CREATE INDEX complaints_complainant_idx ON complaints (complainant_id, created_at DESC);
CREATE UNIQUE INDEX complaints_open_engagement_idx ON complaints (complainant_id, engagement_id) WHERE engagement_id IS NOT NULL AND status IN ('OPEN', 'UNDER_REVIEW');

-- ─── Notifications ──────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id           text PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  actor_id     text REFERENCES users (id) ON DELETE CASCADE,
  type         notification_type NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  snippet      text CHECK (length(snippet) <= 200),
  data         jsonb NOT NULL DEFAULT '{}',
  read_at      timestamptz(3),
  emailed_at   timestamptz(3),
  created_at   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (recipient_id) WHERE read_at IS NULL;

-- ─── Moderation ─────────────────────────────────────────────────────────────

CREATE TABLE moderation_cases (
  id             text PRIMARY KEY,
  target_type    moderation_target NOT NULL,
  target_id      text NOT NULL,
  author_id      text REFERENCES users (id) ON DELETE SET NULL,
  source         case_source NOT NULL,
  status         case_status NOT NULL DEFAULT 'OPEN',
  priority       smallint NOT NULL DEFAULT 0,
  ai_provider    text,
  ai_scores      jsonb,
  ai_categories  text[],
  report_count   integer NOT NULL DEFAULT 0,
  snapshot       jsonb NOT NULL DEFAULT '{}',   -- the content as it was when the case opened
  assigned_to    text REFERENCES users (id) ON DELETE SET NULL,
  resolution     moderation_action_type,
  resolved_by    text REFERENCES users (id) ON DELETE SET NULL,
  opened_at      timestamptz(3) NOT NULL DEFAULT now(),
  resolved_at    timestamptz(3)
);
-- One open case per target: new reports and re-scans attach to it.
CREATE UNIQUE INDEX moderation_cases_open_target_idx ON moderation_cases (target_type, target_id) WHERE status = 'OPEN';
CREATE INDEX moderation_cases_queue_idx ON moderation_cases (priority DESC, opened_at) WHERE status = 'OPEN';

CREATE TABLE reports (
  id          text PRIMARY KEY,
  reporter_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_type moderation_target NOT NULL,
  target_id   text NOT NULL,
  reason      report_reason NOT NULL,
  details     text CHECK (length(details) <= 1000),
  case_id     text REFERENCES moderation_cases (id) ON DELETE SET NULL,
  created_at  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX reports_case_idx ON reports (case_id);

CREATE TABLE moderation_actions (
  id          text PRIMARY KEY,
  case_id     text REFERENCES moderation_cases (id) ON DELETE SET NULL,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,   -- NULL = the automated pipeline
  action      moderation_action_type NOT NULL,
  target_type moderation_target NOT NULL,
  target_id   text NOT NULL,
  reason      text CHECK (length(reason) <= 1000),
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON moderation_actions (target_type, target_id, created_at DESC);
CREATE INDEX moderation_actions_case_idx ON moderation_actions (case_id);

ALTER TABLE complaints ADD CONSTRAINT complaints_action_fk FOREIGN KEY (action_id) REFERENCES moderation_actions (id) ON DELETE SET NULL;

CREATE TABLE appeals (
  id            text PRIMARY KEY,
  case_id       text NOT NULL REFERENCES moderation_cases (id) ON DELETE CASCADE,
  appellant_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  statement     text NOT NULL CHECK (length(statement) BETWEEN 10 AND 2000),
  status        appeal_status NOT NULL DEFAULT 'PENDING',
  decided_by    text REFERENCES users (id) ON DELETE SET NULL,
  decision_note text CHECK (length(decision_note) <= 1000),
  decided_at    timestamptz(3),
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (case_id, appellant_id)
);
CREATE INDEX appeals_pending_idx ON appeals (created_at) WHERE status = 'PENDING';

-- ─── Platform ───────────────────────────────────────────────────────────────

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  actor_id    text REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  ip          inet,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_recent_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
