# Test ids

Stable `data-testid` hooks for end-to-end tests. Prefer accessible names (roles and labels) where they exist; these ids cover elements without a unique accessible name. `<id>` marks a dynamic suffix (for example `case-action-<id>` is `case-action-hide`).

Generated from the source by `node scripts/gen-testids.mjs`; rerun it after adding or renaming an id.

## Shell and navigation

| Test id | Source |
|---|---|
| `avatar-menu` | `components/shell/avatar-menu.tsx` |
| `confirm-action` | `components/common/confirm-dialog.tsx` |
| `nav-<id>` | `components/shell/header.tsx` |
| `nav-admin` | `components/shell/avatar-menu.tsx` |
| `nav-moderation` | `components/shell/avatar-menu.tsx` |
| `nav-recruiter` | `components/shell/header.tsx` |
| `notifications-bell` | `components/shell/notifications-bell.tsx` |
| `notifications-dropdown` | `components/shell/notifications-bell.tsx` |
| `rail-completeness` | `components/shell/left-rail.tsx` |
| `rail-profile-card` | `components/shell/left-rail.tsx` |
| `report-dialog` | `components/common/report-dialog.tsx` |
| `report-reason-<id>` | `components/common/report-dialog.tsx` |
| `report-submit` | `components/common/report-dialog.tsx` |
| `restriction-banner` | `components/shell/restriction-banner.tsx` |
| `search-input` | `components/shell/search-box.tsx` |
| `sign-out` | `components/shell/avatar-menu.tsx` |
| `theme-dark` | `components/shell/avatar-menu.tsx` |
| `theme-light` | `components/shell/avatar-menu.tsx` |
| `theme-system` | `components/shell/avatar-menu.tsx` |
| `view-profile` | `components/shell/avatar-menu.tsx` |

## Landing

| Test id | Source |
|---|---|
| `landing-companies` | `components/landing/landing.tsx` |
| `landing-jobs` | `components/landing/landing.tsx` |
| `landing-join` | `components/landing/landing.tsx` |
| `landing-search` | `components/landing/landing.tsx` |
| `landing-title` | `components/landing/landing.tsx` |

## Sign up and sign in

| Test id | Source |
|---|---|
| `forgot-sent` | `components/auth/forgot-password.tsx` |
| `forgot-submit` | `components/auth/forgot-password.tsx` |
| `goodbye` | `components/auth/goodbye.tsx` |
| `login-submit` | `components/auth/login-form.tsx` |
| `recovery-code-input` | `components/auth/login-form.tsx` |
| `recovery-toggle` | `components/auth/login-form.tsx` |
| `reset-done` | `components/auth/reset-password.tsx` |
| `reset-submit` | `components/auth/reset-password.tsx` |
| `signup-check-email` | `components/auth/signup-form.tsx` |
| `signup-invite-code` | `components/auth/signup-form.tsx` |
| `signup-submit` | `components/auth/signup-form.tsx` |
| `totp-input` | `components/auth/login-form.tsx` |

## Feed, posts and comments

| Test id | Source |
|---|---|
| `comment` | `components/posts/comments.tsx` |
| `comment-button` | `components/posts/post-card.tsx` |
| `comment-input` | `components/posts/comments.tsx` |
| `comment-submit` | `components/posts/comments.tsx` |
| `comments` | `components/posts/comments.tsx` |
| `comments-more` | `components/posts/comments.tsx` |
| `composer` | `components/posts/composer.tsx` |
| `composer-as` | `components/posts/composer.tsx` |
| `composer-audience` | `components/posts/composer.tsx` |
| `composer-card` | `components/posts/composer.tsx` |
| `composer-dialog` | `components/posts/composer.tsx` |
| `composer-file-input` | `components/posts/composer.tsx` |
| `composer-input` | `components/posts/composer.tsx` |
| `composer-job` | `components/posts/composer.tsx` |
| `composer-kind` | `components/posts/composer.tsx` |
| `composer-submit` | `components/posts/composer.tsx` |
| `file-chip` | `components/media/media-mosaic.tsx` |
| `lightbox` | `components/media/lightbox.tsx` |
| `media-mosaic` | `components/media/media-mosaic.tsx` |
| `new-posts-pill` | `components/feed/home-feed.tsx` |
| `post-bookmark` | `components/posts/post-menu.tsx` |
| `post-card` | `components/posts/post-card.tsx` |
| `post-counts` | `components/posts/post-card.tsx` |
| `post-delete` | `components/posts/post-menu.tsx` |
| `post-edit` | `components/posts/post-menu.tsx` |
| `post-feed` | `components/posts/post-feed.tsx` |
| `post-hide` | `components/posts/post-menu.tsx` |
| `post-job` | `components/posts/post-card.tsx` |
| `post-menu` | `components/posts/post-menu.tsx` |
| `post-report` | `components/posts/post-menu.tsx` |
| `post-skeleton` | `components/posts/post-card.tsx` |
| `post-status-banner` | `components/posts/post-card.tsx` |
| `reaction-<id>` | `components/posts/reactions.tsx` |
| `reaction-picker` | `components/posts/reactions.tsx` |
| `share-button` | `components/posts/post-card.tsx` |
| `share-dialog` | `components/posts/share-dialog.tsx` |
| `share-submit` | `components/posts/share-dialog.tsx` |
| `shared-post` | `components/posts/post-card.tsx` |
| `upload-previews` | `components/media/upload-previews.tsx` |
| `view-replies` | `components/posts/comments.tsx` |

## Talent page and setup

| Test id | Source |
|---|---|
| `<id>-add` | `components/profile/section-card.tsx` |
| `<id>-edit` | `components/profile/section-card.tsx` |
| `<id>-list` | `components/profile/people-list.tsx` |
| `activity-post` | `components/profile/profile-activity.tsx` |
| `activity-toggle` | `components/profile/profile-activity.tsx` |
| `add-first-<id>` | `components/profile/profile-sections.tsx` |
| `add-section` | `components/profile/profile-header.tsx` |
| `add-section-<id>` | `components/profile/profile-header.tsx` |
| `approach-blocked-reason` | `components/profile/profile-header.tsx` |
| `approach-button` | `components/profile/profile-header.tsx` |
| `approach-dialog` | `components/profile/recruiter-actions.tsx` |
| `approach-job` | `components/profile/recruiter-actions.tsx` |
| `approach-message` | `components/profile/recruiter-actions.tsx` |
| `approach-role` | `components/profile/recruiter-actions.tsx` |
| `approach-send` | `components/profile/recruiter-actions.tsx` |
| `basics-about` | `components/profile/basics-editor.tsx` |
| `basics-editor` | `components/profile/basics-editor.tsx` |
| `basics-headline` | `components/profile/basics-editor.tsx` |
| `basics-save` | `components/profile/basics-editor.tsx` |
| `contact-<id>` | `components/profile/recruiter-actions.tsx` |
| `contact-dialog` | `components/profile/recruiter-actions.tsx` |
| `contact-editor` | `components/profile/owner-panel.tsx` |
| `contact-email-input` | `components/profile/owner-panel.tsx` |
| `contact-phone-input` | `components/profile/owner-panel.tsx` |
| `contact-reveal` | `components/profile/recruiter-actions.tsx` |
| `contact-save` | `components/profile/owner-panel.tsx` |
| `contact-whatsapp-input` | `components/profile/owner-panel.tsx` |
| `draft-profile` | `components/profile/owner-panel.tsx` |
| `edit-basics-pencil` | `components/profile/profile-header.tsx` |
| `edit-profile` | `components/profile/profile-header.tsx` |
| `editor-add` | `components/profile/section-editor.tsx` |
| `editor-item` | `components/profile/section-editor.tsx` |
| `editor-save` | `components/profile/section-editor.tsx` |
| `endorse-button` | `components/profile/profile-sections.tsx` |
| `hidden-section-<id>` | `components/profile/section-card.tsx` |
| `import-apply` | `components/profile/setup/import-steps.tsx` |
| `import-dropzone` | `components/profile/setup/profile-setup.tsx` |
| `import-file` | `components/profile/setup/profile-setup.tsx` |
| `import-file-input` | `components/profile/setup/profile-setup.tsx` |
| `import-missing` | `components/profile/setup/import-steps.tsx` |
| `import-progress` | `components/profile/setup/import-steps.tsx` |
| `import-retry` | `components/profile/setup/import-steps.tsx` |
| `import-review` | `components/profile/setup/import-steps.tsx` |
| `import-start` | `components/profile/setup/profile-setup.tsx` |
| `import-text` | `components/profile/setup/profile-setup.tsx` |
| `invite-dialog` | `components/profile/recruiter-actions.tsx` |
| `invite-job` | `components/profile/recruiter-actions.tsx` |
| `invite-send` | `components/profile/recruiter-actions.tsx` |
| `invite-to-apply` | `components/profile/profile-header.tsx` |
| `message-button` | `components/profile/profile-header.tsx` |
| `message-request-button` | `components/profile/profile-header.tsx` |
| `missing-hint` | `components/profile/owner-panel.tsx` |
| `mutual-card` | `components/profile/profile-page.tsx` |
| `mutual-count` | `components/profile/profile-header.tsx` |
| `open-to-work-card` | `components/profile/profile-sections.tsx` |
| `open-to-work-edit` | `components/profile/profile-sections.tsx` |
| `open-to-work-editor` | `components/profile/owner-panel.tsx` |
| `open-to-work-save` | `components/profile/owner-panel.tsx` |
| `owner-contact` | `components/profile/owner-panel.tsx` |
| `owner-open-to-work` | `components/profile/owner-panel.tsx` |
| `owner-strip` | `components/profile/owner-panel.tsx` |
| `owner-visibility` | `components/profile/owner-panel.tsx` |
| `polish-<id>` | `components/profile/basics-editor.tsx` |
| `polish-suggestion` | `components/profile/basics-editor.tsx` |
| `profile-actions` | `components/profile/profile-header.tsx` |
| `profile-badge` | `components/profile/profile-badges.tsx` |
| `profile-badges` | `components/profile/profile-badges.tsx` |
| `profile-header` | `components/profile/profile-header.tsx` |
| `profile-insights` | `components/profile/profile-page.tsx` |
| `profile-menu` | `components/profile/profile-header.tsx` |
| `profile-setup` | `components/profile/setup/profile-setup.tsx` |
| `profile-stats` | `components/profile/profile-header.tsx` |
| `profile-status` | `components/profile/owner-panel.tsx` |
| `publish-blocked` | `components/profile/setup/finish-step.tsx` |
| `publish-profile` | `components/profile/owner-panel.tsx` |
| `rating-item` | `components/profile/profile-activity.tsx` |
| `rating-summary` | `components/profile/profile-badges.tsx` |
| `remove-connection` | `components/profile/profile-header.tsx` |
| `report-user` | `components/profile/profile-header.tsx` |
| `resume-docx` | `components/profile/profile-header.tsx` |
| `resume-download` | `components/profile/profile-header.tsx` |
| `resume-import` | `components/profile/setup/profile-setup.tsx` |
| `resume-pdf` | `components/profile/profile-header.tsx` |
| `save-candidate` | `components/profile/recruiter-actions.tsx` |
| `section-editor-<id>` | `components/profile/section-editor.tsx` |
| `setup-finish` | `components/profile/setup/finish-step.tsx` |
| `setup-manual` | `components/profile/setup/profile-setup.tsx` |
| `setup-publish` | `components/profile/setup/finish-step.tsx` |
| `setup-save-draft` | `components/profile/setup/finish-step.tsx` |
| `share-profile` | `components/profile/profile-header.tsx` |
| `skill-row` | `components/profile/profile-sections.tsx` |
| `skills-toggle` | `components/profile/profile-sections.tsx` |
| `unlist-profile` | `components/profile/owner-panel.tsx` |
| `video-click-to-load` | `components/profile/profile-sections.tsx` |
| `view-contact` | `components/profile/profile-header.tsx` |
| `visibility-<id>` | `components/profile/owner-panel.tsx` |
| `visibility-editor` | `components/profile/owner-panel.tsx` |
| `visibility-save` | `components/profile/owner-panel.tsx` |
| `voice-recorder` | `components/profile/setup/voice-recorder.tsx` |
| `voice-start` | `components/profile/setup/voice-recorder.tsx` |
| `voice-stop` | `components/profile/setup/voice-recorder.tsx` |

## Network and directory

| Test id | Source |
|---|---|
| `connect-accept` | `components/network/connect-button.tsx` |
| `connect-button` | `components/network/connect-button.tsx` |
| `connect-note` | `components/network/connect-button.tsx` |
| `connect-pending` | `components/network/connect-button.tsx` |
| `connect-send` | `components/network/connect-button.tsx` |
| `connection-menu` | `components/network/connections-page.tsx` |
| `connection-message` | `components/network/connections-page.tsx` |
| `connection-remove` | `components/network/connections-page.tsx` |
| `connection-row` | `components/network/connections-page.tsx` |
| `connections-filter` | `components/network/connections-page.tsx` |
| `connections-page` | `components/network/connections-page.tsx` |
| `connections-sort` | `components/network/connections-page.tsx` |
| `invitation-accept` | `components/network/invitations-card.tsx` |
| `invitation-ignore` | `components/network/invitations-card.tsx` |
| `invitation-row` | `components/network/invitations-card.tsx` |
| `invitation-withdraw` | `components/network/invitations-card.tsx` |
| `message-button` | `components/network/connect-button.tsx` |
| `network-invitations` | `components/network/invitations-card.tsx` |
| `network-manage` | `components/network/manage-card.tsx` |
| `network-suggestions` | `components/network/suggestions-grid.tsx` |
| `search-company` | `components/search/result-rows.tsx` |
| `search-empty` | `components/search/search-page.tsx` |
| `search-job` | `components/search/result-rows.tsx` |
| `search-page` | `components/search/search-page.tsx` |
| `search-tab-<id>` | `components/search/search-page.tsx` |
| `suggestion-card` | `components/network/suggestions-grid.tsx` |
| `suggestion-dismiss` | `components/network/suggestions-grid.tsx` |
| `talent-active-filters` | `components/talent/talent-page.tsx` |
| `talent-card` | `components/talent/talent-card.tsx` |
| `talent-clear-filters` | `components/talent/talent-filters.tsx` |
| `talent-filters` | `components/talent/talent-filters.tsx` |
| `talent-filters-done` | `components/talent/talent-page.tsx` |
| `talent-filters-open` | `components/talent/talent-page.tsx` |
| `talent-location` | `components/talent/talent-filters.tsx` |
| `talent-open-to-work` | `components/talent/talent-filters.tsx` |
| `talent-page` | `components/talent/talent-page.tsx` |
| `talent-search` | `components/talent/talent-page.tsx` |
| `talent-search-submit` | `components/talent/talent-page.tsx` |
| `talent-skill-filter` | `components/talent/talent-filters.tsx` |
| `talent-sort` | `components/talent/talent-filters.tsx` |
| `talent-view-grid` | `components/talent/talent-page.tsx` |
| `talent-view-list` | `components/talent/talent-page.tsx` |
| `talent-years` | `components/talent/talent-filters.tsx` |

## Jobs and applications

| Test id | Source |
|---|---|
| `application-card` | `components/jobs/applications-page.tsx` |
| `application-message` | `components/jobs/applications-page.tsx` |
| `application-withdraw` | `components/jobs/applications-page.tsx` |
| `applications` | `components/jobs/applications-page.tsx` |
| `applications-page` | `components/jobs/applications-page.tsx` |
| `apply-draft-warning` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-error` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-next` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-note` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-question` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-resume` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-resume-input` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-resume-pick` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-resume-remove` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-review` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-snapshot` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-submit` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-success` | `components/jobs/easy-apply-dialog.tsx` |
| `apply-view-timeline` | `components/jobs/easy-apply-dialog.tsx` |
| `easy-apply-dialog` | `components/jobs/easy-apply-dialog.tsx` |
| `filter-clear` | `components/jobs/job-filter-bar.tsx` |
| `invite-decline` | `components/jobs/job-invites.tsx` |
| `invite-interested` | `components/jobs/job-invites.tsx` |
| `job-applied` | `components/jobs/job-detail.tsx` |
| `job-back` | `components/jobs/job-detail.tsx` |
| `job-card` | `components/jobs/job-bits.tsx` |
| `job-card-save` | `components/jobs/job-bits.tsx` |
| `job-description` | `components/jobs/job-bits.tsx` |
| `job-detail` | `components/jobs/job-detail.tsx` |
| `job-easy-apply` | `components/jobs/job-detail.tsx` |
| `job-filter-bar` | `components/jobs/job-filter-bar.tsx` |
| `job-invite` | `components/jobs/job-invites.tsx` |
| `job-invites` | `components/jobs/job-invites.tsx` |
| `job-more` | `components/jobs/job-detail.tsx` |
| `job-report` | `components/jobs/job-detail.tsx` |
| `job-results` | `components/jobs/jobs-page.tsx` |
| `job-save` | `components/jobs/job-detail.tsx` |
| `job-search-location` | `components/jobs/job-filter-bar.tsx` |
| `job-search-q` | `components/jobs/job-filter-bar.tsx` |
| `job-search-submit` | `components/jobs/job-filter-bar.tsx` |
| `job-share` | `components/jobs/job-detail.tsx` |
| `job-sign-in-to-apply` | `components/jobs/job-detail.tsx` |
| `jobs-empty-clear` | `components/jobs/jobs-page.tsx` |
| `jobs-page` | `components/jobs/jobs-page.tsx` |
| `jobs-recommended` | `components/jobs/job-invites.tsx` |
| `match-chip` | `components/jobs/job-bits.tsx` |
| `saved-jobs` | `components/jobs/saved-jobs-page.tsx` |
| `saved-jobs-page` | `components/jobs/saved-jobs-page.tsx` |
| `stage-badge` | `components/jobs/job-bits.tsx` |
| `stage-timeline` | `components/jobs/applications-page.tsx` |

## Companies

| Test id | Source |
|---|---|
| `<id>-input` | `components/companies/company-edit-dialog.tsx` |
| `companies-industry` | `components/companies/companies-page.tsx` |
| `companies-list` | `components/companies/companies-page.tsx` |
| `companies-page` | `components/companies/companies-page.tsx` |
| `companies-search` | `components/companies/companies-page.tsx` |
| `company-auto-approve` | `components/companies/company-edit-dialog.tsx` |
| `company-card` | `components/companies/company-card.tsx` |
| `company-domains` | `components/companies/company-edit-dialog.tsx` |
| `company-edit` | `components/companies/company-page.tsx` |
| `company-edit-dialog` | `components/companies/company-edit-dialog.tsx` |
| `company-edit-save` | `components/companies/company-edit-dialog.tsx` |
| `company-follow` | `components/companies/follow-button.tsx` |
| `company-followers` | `components/companies/company-page.tsx` |
| `company-header` | `components/companies/company-page.tsx` |
| `company-home-jobs` | `components/companies/company-sections.tsx` |
| `company-home-posts` | `components/companies/company-sections.tsx` |
| `company-jobs` | `components/companies/company-sections.tsx` |
| `company-more` | `components/companies/company-page.tsx` |
| `company-page` | `components/companies/company-page.tsx` |
| `company-report` | `components/companies/company-page.tsx` |
| `company-suspended` | `components/companies/company-page.tsx` |
| `company-tab-<id>` | `components/companies/company-page.tsx` |
| `company-website` | `components/companies/company-page.tsx` |
| `team-member` | `components/companies/company-team.tsx` |
| `team-remove` | `components/companies/company-team.tsx` |
| `team-role` | `components/companies/company-team.tsx` |

## Recruiter workspace

| Test id | Source |
|---|---|
| `approach-engagement` | `components/recruiter/approaches-page.tsx` |
| `approach-row` | `components/recruiter/approaches-page.tsx` |
| `approach-thread` | `components/recruiter/approaches-page.tsx` |
| `approach-view-contact` | `components/recruiter/approaches-page.tsx` |
| `approach-withdraw` | `components/recruiter/approaches-page.tsx` |
| `approaches-tab-<id>` | `components/recruiter/approaches-page.tsx` |
| `bulk-move-to-<id>` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `candidate-drawer` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `contact-details` | `components/recruiter/approaches-page.tsx` |
| `contact-dialog` | `components/recruiter/approaches-page.tsx` |
| `contact-reveal` | `components/recruiter/approaches-page.tsx` |
| `drawer-engagement` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `drawer-message` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `drawer-move` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `drawer-profile` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `drawer-resume` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `drawer-stage` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `eng-cancel` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-complete` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-confirm` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-confirm-complete` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-dispute` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-propose-submit` | `components/recruiter/engagements/propose-dialog.tsx` |
| `eng-rate` | `components/recruiter/engagements/engagements-page.tsx` |
| `eng-title` | `components/recruiter/engagements/propose-dialog.tsx` |
| `engagement-card` | `components/recruiter/engagements/engagements-page.tsx` |
| `invite-dialog` | `components/recruiter/talent/invite-dialog.tsx` |
| `invite-job` | `components/recruiter/talent/invite-dialog.tsx` |
| `invite-send` | `components/recruiter/talent/invite-dialog.tsx` |
| `job-actions` | `components/recruiter/jobs/job-actions.tsx` |
| `job-add-question` | `components/recruiter/jobs/job-form.tsx` |
| `job-close` | `components/recruiter/jobs/job-actions.tsx` |
| `job-description` | `components/recruiter/jobs/job-form.tsx` |
| `job-description-preview` | `components/recruiter/jobs/job-form.tsx` |
| `job-edit` | `components/recruiter/jobs/job-actions.tsx` |
| `job-employment` | `components/recruiter/jobs/job-form.tsx` |
| `job-fill` | `components/recruiter/jobs/job-actions.tsx` |
| `job-form` | `components/recruiter/jobs/job-form.tsx` |
| `job-form-error` | `components/recruiter/jobs/job-form.tsx` |
| `job-open` | `components/recruiter/jobs/job-actions.tsx` |
| `job-publish` | `components/recruiter/jobs/job-form.tsx` |
| `job-question` | `components/recruiter/jobs/job-form.tsx` |
| `job-questions` | `components/recruiter/jobs/job-form.tsx` |
| `job-row` | `components/recruiter/jobs/jobs-page.tsx` |
| `job-save` | `components/recruiter/jobs/job-form.tsx` |
| `job-save-draft` | `components/recruiter/jobs/job-form.tsx` |
| `job-share` | `components/recruiter/jobs/job-actions.tsx` |
| `job-title` | `components/recruiter/jobs/job-form.tsx` |
| `job-workplace` | `components/recruiter/jobs/job-form.tsx` |
| `jobs-new` | `components/recruiter/jobs/jobs-page.tsx` |
| `jobs-tab-<id>` | `components/recruiter/jobs/jobs-page.tsx` |
| `move-to-<id>` | `components/recruiter/pipeline/pipeline-card.tsx` |
| `note-body` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `note-form` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `note-list` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `note-submit` | `components/recruiter/pipeline/candidate-drawer.tsx` |
| `pipeline-board` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-bulk-bar` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-bulk-clear` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-bulk-move` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-card` | `components/recruiter/pipeline/pipeline-card.tsx` |
| `pipeline-card-menu` | `components/recruiter/pipeline/pipeline-card.tsx` |
| `pipeline-card-open` | `components/recruiter/pipeline/pipeline-card.tsx` |
| `pipeline-card-select` | `components/recruiter/pipeline/pipeline-card.tsx` |
| `pipeline-column-<id>` | `components/recruiter/pipeline/pipeline-column.tsx` |
| `pipeline-column-count` | `components/recruiter/pipeline/pipeline-column.tsx` |
| `pipeline-column-more` | `components/recruiter/pipeline/pipeline-column.tsx` |
| `pipeline-edit` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-filter` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-page` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-share` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `pipeline-title` | `components/recruiter/pipeline/pipeline-page.tsx` |
| `propose-engagement-dialog` | `components/recruiter/engagements/propose-dialog.tsx` |
| `rate-dialog` | `components/recruiter/engagements/engagements-page.tsx` |
| `rate-submit` | `components/recruiter/engagements/engagements-page.tsx` |
| `rc-code-error` | `components/recruiter/join/verify-code.tsx` |
| `rc-code-input` | `components/recruiter/join/verify-code.tsx` |
| `rc-code-resend` | `components/recruiter/join/verify-code.tsx` |
| `rc-code-restart` | `components/recruiter/join/verify-code.tsx` |
| `rc-code-submit` | `components/recruiter/join/verify-code.tsx` |
| `rc-company-name` | `components/recruiter/join/register-form.tsx` |
| `rc-company-option` | `components/recruiter/join/register-form.tsx` |
| `rc-company-search` | `components/recruiter/join/register-form.tsx` |
| `rc-create-instead` | `components/recruiter/join/register-form.tsx` |
| `rc-picked-company` | `components/recruiter/join/register-form.tsx` |
| `rc-register-error` | `components/recruiter/join/register-form.tsx` |
| `rc-register-submit` | `components/recruiter/join/register-form.tsx` |
| `rc-work-email` | `components/recruiter/join/register-form.tsx` |
| `recruiter-approaches` | `components/recruiter/approaches-page.tsx` |
| `recruiter-company-card` | `components/recruiter/home-page.tsx` |
| `recruiter-engagements` | `components/recruiter/engagements/engagements-page.tsx` |
| `recruiter-home` | `components/recruiter/home-page.tsx` |
| `recruiter-jobs` | `components/recruiter/jobs/jobs-page.tsx` |
| `recruiter-open-workspace` | `components/recruiter/join/join-page.tsx` |
| `recruiter-post-job` | `components/recruiter/home-page.tsx` |
| `recruiter-quota` | `components/recruiter/home-page.tsx` |
| `recruiter-reapply` | `components/recruiter/join/join-page.tsx` |
| `recruiter-recent-applications` | `components/recruiter/home-page.tsx` |
| `recruiter-register-form` | `components/recruiter/join/register-form.tsx` |
| `recruiter-settings` | `components/recruiter/settings-page.tsx` |
| `recruiter-verify` | `components/recruiter/join/verify-code.tsx` |
| `reject-confirm` | `components/recruiter/pipeline/reject-dialog.tsx` |
| `reject-dialog` | `components/recruiter/pipeline/reject-dialog.tsx` |
| `reject-reason` | `components/recruiter/pipeline/reject-dialog.tsx` |
| `rs-leave` | `components/recruiter/settings-page.tsx` |
| `rs-must-transfer` | `components/recruiter/settings-page.tsx` |
| `rs-save` | `components/recruiter/settings-page.tsx` |
| `rs-title` | `components/recruiter/settings-page.tsx` |
| `save-search-dialog` | `components/recruiter/talent/talent-page.tsx` |
| `save-search-name` | `components/recruiter/talent/talent-page.tsx` |
| `save-search-submit` | `components/recruiter/talent/talent-page.tsx` |
| `saved-candidates` | `components/recruiter/saved-page.tsx` |
| `saved-edit-note` | `components/recruiter/saved-page.tsx` |
| `saved-note-input` | `components/recruiter/saved-page.tsx` |
| `saved-note-save` | `components/recruiter/saved-page.tsx` |
| `saved-search-delete` | `components/recruiter/talent/talent-page.tsx` |
| `saved-search-run` | `components/recruiter/talent/talent-page.tsx` |
| `saved-searches` | `components/recruiter/talent/talent-page.tsx` |
| `talent-approach` | `components/recruiter/talent/talent-card.tsx` |
| `talent-filters` | `components/recruiter/talent/talent-page.tsx` |
| `talent-filters-open` | `components/recruiter/talent/talent-page.tsx` |
| `talent-invite` | `components/recruiter/talent/talent-card.tsx` |
| `talent-location` | `components/recruiter/talent/talent-page.tsx` |
| `talent-max-years` | `components/recruiter/talent/talent-page.tsx` |
| `talent-min-years` | `components/recruiter/talent/talent-page.tsx` |
| `talent-otw` | `components/recruiter/talent/talent-page.tsx` |
| `talent-q` | `components/recruiter/talent/talent-page.tsx` |
| `talent-reset` | `components/recruiter/talent/talent-page.tsx` |
| `talent-save` | `components/recruiter/talent/talent-card.tsx` |
| `talent-save-search` | `components/recruiter/talent/talent-page.tsx` |
| `talent-search` | `components/recruiter/talent/talent-page.tsx` |
| `talent-sort` | `components/recruiter/talent/talent-page.tsx` |

## Candidate dashboard

| Test id | Source |
|---|---|
| `accept-channel-<id>` | `components/dashboard/approach-dialogs.tsx` |
| `approach-accept` | `components/dashboard/approaches-tab.tsx` |
| `approach-accept-confirm` | `components/dashboard/approach-dialogs.tsx` |
| `approach-accept-dialog` | `components/dashboard/approach-dialogs.tsx` |
| `approach-block` | `components/dashboard/approaches-tab.tsx` |
| `approach-card` | `components/dashboard/approaches-tab.tsx` |
| `approach-decline` | `components/dashboard/approaches-tab.tsx` |
| `approach-decline-confirm` | `components/dashboard/approach-dialogs.tsx` |
| `approach-decline-dialog` | `components/dashboard/approach-dialogs.tsx` |
| `approach-decline-reason` | `components/dashboard/approach-dialogs.tsx` |
| `approach-menu` | `components/dashboard/approaches-tab.tsx` |
| `approach-revoke` | `components/dashboard/approaches-tab.tsx` |
| `approach-thread` | `components/dashboard/approaches-tab.tsx` |
| `approaches-list` | `components/dashboard/approaches-tab.tsx` |
| `complaint-add-evidence` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-against` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-category` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-context` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-description` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-dialog` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-error` | `components/dashboard/complaint-dialog.tsx` |
| `complaint-new` | `components/dashboard/complaints-tab.tsx` |
| `complaint-row` | `components/dashboard/complaints-tab.tsx` |
| `complaint-submit` | `components/dashboard/complaint-dialog.tsx` |
| `contact-log` | `components/dashboard/contact-log-tab.tsx` |
| `dashboard-approach-summary` | `components/dashboard/overview-tab.tsx` |
| `dashboard-open-approaches` | `components/dashboard/overview-tab.tsx` |
| `dashboard-page` | `components/dashboard/dashboard-page.tsx` |
| `dashboard-recruiter-companies` | `components/dashboard/overview-tab.tsx` |
| `dashboard-setup-cta` | `components/dashboard/overview-tab.tsx` |
| `dashboard-strength` | `components/dashboard/overview-tab.tsx` |
| `dashboard-tab-<id>` | `components/dashboard/dashboard-page.tsx` |
| `engagement-cancel` | `components/dashboard/engagements-tab.tsx` |
| `engagement-complete` | `components/dashboard/engagements-tab.tsx` |
| `engagement-confirm` | `components/dashboard/engagements-tab.tsx` |
| `engagement-confirm-complete` | `components/dashboard/engagements-tab.tsx` |
| `engagement-dispute` | `components/dashboard/engagements-tab.tsx` |
| `engagement-rate` | `components/dashboard/engagements-tab.tsx` |
| `engagement-report` | `components/dashboard/engagements-tab.tsx` |
| `engagement-row` | `components/dashboard/engagements-tab.tsx` |
| `job-invite` | `components/dashboard/invites-tab.tsx` |
| `job-invite-decline` | `components/dashboard/invites-tab.tsx` |
| `job-invite-interested` | `components/dashboard/invites-tab.tsx` |
| `rate-comment` | `components/dashboard/rate-dialog.tsx` |
| `rate-dialog` | `components/dashboard/rate-dialog.tsx` |
| `rate-submit` | `components/dashboard/rate-dialog.tsx` |
| `views-chart` | `components/dashboard/views-chart.tsx` |

## Messaging

| Test id | Source |
|---|---|
| `attach-button` | `components/messages/composer.tsx` |
| `cannot-reply` | `components/messages/conversation.tsx` |
| `conversation` | `components/messages/conversation.tsx` |
| `dm-as-request` | `components/messages/new-message-dialog.tsx` |
| `dm-denial` | `components/messages/new-message-dialog.tsx` |
| `dm-dock` | `components/messages/dock.tsx` |
| `dm-seen` | `components/messages/message-bubble.tsx` |
| `dock-close` | `components/messages/dock.tsx` |
| `dock-head` | `components/messages/dock.tsx` |
| `dock-minimize` | `components/messages/dock.tsx` |
| `dock-window` | `components/messages/dock.tsx` |
| `message-actions` | `components/messages/message-bubble.tsx` |
| `message-bubble` | `components/messages/message-bubble.tsx` |
| `message-delete` | `components/messages/message-bubble.tsx` |
| `message-edit` | `components/messages/message-bubble.tsx` |
| `message-input` | `components/messages/composer.tsx` |
| `message-react` | `components/messages/message-bubble.tsx` |
| `message-reply` | `components/messages/message-bubble.tsx` |
| `message-report` | `components/messages/message-bubble.tsx` |
| `message-send` | `components/messages/composer.tsx` |
| `mute-toggle` | `components/messages/conversation.tsx` |
| `new-message-button` | `components/messages/dock.tsx`, `components/messages/thread-list.tsx` |
| `new-message-dialog` | `components/messages/new-message-dialog.tsx` |
| `new-message-search` | `components/messages/people-picker.tsx` |
| `new-message-start` | `components/messages/new-message-dialog.tsx` |
| `person-option` | `components/messages/people-picker.tsx` |
| `reply-banner` | `components/messages/composer.tsx` |
| `request-accept` | `components/messages/conversation.tsx` |
| `request-banner` | `components/messages/conversation.tsx` |
| `request-decline` | `components/messages/conversation.tsx` |
| `thread-archive` | `components/messages/conversation.tsx` |
| `thread-context` | `components/messages/conversation.tsx` |
| `thread-item` | `components/messages/thread-list.tsx` |
| `thread-list` | `components/messages/thread-list.tsx` |
| `thread-menu` | `components/messages/conversation.tsx` |
| `typing-indicator` | `components/messages/typing-indicator.tsx` |

## Notifications

| Test id | Source |
|---|---|
| `mark-all-read` | `components/notifications/notifications-page.tsx` |
| `notification-item` | `components/notifications/notification-item.tsx` |
| `notification-list` | `components/notifications/notifications-page.tsx` |
| `notifications-page` | `components/notifications/notifications-page.tsx` |

## Settings

| Test id | Source |
|---|---|
| `avatar-upload` | `components/settings/profile-section.tsx` |
| `blocked-list` | `components/settings/blocked-section.tsx` |
| `delete-account` | `components/settings/account-section.tsx` |
| `delete-account-confirm` | `components/settings/account-section.tsx` |
| `delete-account-dialog` | `components/settings/account-section.tsx` |
| `delete-confirm-username` | `components/settings/account-section.tsx` |
| `delete-totp` | `components/settings/account-section.tsx` |
| `email-digest` | `components/settings/profile-section.tsx` |
| `email-digest-toggle` | `components/settings/email-section.tsx` |
| `export-data` | `components/settings/account-section.tsx` |
| `message-policy-<id>` | `components/settings/privacy-section.tsx` |
| `recovery-codes` | `components/settings/recovery-codes.tsx` |
| `recovery-copy` | `components/settings/recovery-codes.tsx` |
| `recovery-done` | `components/settings/recovery-codes.tsx` |
| `recovery-download` | `components/settings/recovery-codes.tsx` |
| `recovery-saved` | `components/settings/recovery-codes.tsx` |
| `session-revoke` | `components/settings/sessions-section.tsx` |
| `sessions-list` | `components/settings/sessions-section.tsx` |
| `sessions-sign-out-all` | `components/settings/sessions-section.tsx` |
| `settings-nav-<id>` | `components/settings/settings-page.tsx` |
| `settings-save` | `components/settings/password-section.tsx`, `components/settings/privacy-section.tsx`, `components/settings/profile-section.tsx` |
| `totp-confirm-code` | `components/settings/two-factor-section.tsx` |
| `totp-disable` | `components/settings/two-factor-section.tsx` |
| `totp-enable` | `components/settings/two-factor-section.tsx` |
| `totp-qr` | `components/settings/two-factor-section.tsx` |
| `totp-regenerate` | `components/settings/two-factor-section.tsx` |
| `totp-start` | `components/settings/two-factor-section.tsx` |
| `unblock` | `components/settings/blocked-section.tsx` |
| `username-input` | `components/settings/profile-section.tsx` |
| `username-save` | `components/settings/profile-section.tsx` |

## Moderation

| Test id | Source |
|---|---|
| `appeal-card` | `components/moderation/moderation-desk.tsx` |
| `appeal-filter` | `components/moderation/moderation-desk.tsx` |
| `appeal-open-case` | `components/moderation/moderation-desk.tsx` |
| `appeal-overturn` | `components/moderation/appeal-decision.tsx` |
| `appeal-panel` | `components/moderation/my-cases.tsx` |
| `appeal-submit` | `components/moderation/my-cases.tsx` |
| `appeal-uphold` | `components/moderation/appeal-decision.tsx` |
| `appeals-list` | `components/moderation/moderation-desk.tsx` |
| `case-action-<id>` | `components/moderation/case-drawer.tsx` |
| `case-action-suspend` | `components/moderation/case-drawer.tsx` |
| `case-appeal` | `components/moderation/case-drawer.tsx` |
| `case-assign-me` | `components/moderation/case-drawer.tsx` |
| `case-author` | `components/moderation/case-drawer.tsx` |
| `case-drawer` | `components/moderation/case-drawer.tsx` |
| `case-history` | `components/moderation/case-drawer.tsx` |
| `case-snapshot` | `components/moderation/case-drawer.tsx` |
| `case-tab-appeal` | `components/moderation/case-drawer.tsx` |
| `case-tab-history` | `components/moderation/case-drawer.tsx` |
| `filter-source` | `components/moderation/moderation-desk.tsx` |
| `filter-status` | `components/moderation/moderation-desk.tsx` |
| `filter-type` | `components/moderation/moderation-desk.tsx` |
| `mod-reason` | `components/moderation/case-drawer.tsx` |
| `moderation-case` | `components/moderation/moderation-desk.tsx` |
| `moderation-open-count` | `components/moderation/moderation-desk.tsx` |
| `moderation-queue` | `components/moderation/moderation-desk.tsx` |
| `moderation-stats` | `components/moderation/moderation-desk.tsx` |
| `my-cases` | `components/moderation/my-cases.tsx` |
| `suspend-days` | `components/moderation/case-drawer.tsx` |
| `tab-appeals` | `components/moderation/moderation-desk.tsx` |
| `tab-queue` | `components/moderation/moderation-desk.tsx` |

## Admin control plane

| Test id | Source |
|---|---|
| `<id>-input` | `components/admin/settings-form.tsx` |
| `admin-area-<id>` | `components/admin/admin-page.tsx` |
| `admin-forbidden` | `components/admin/admin-bits.tsx` |
| `admin-funnel` | `components/admin/overview.tsx` |
| `admin-moderation-enabled` | `components/admin/settings-form.tsx` |
| `admin-nav` | `components/admin/admin-page.tsx` |
| `admin-settings-form` | `components/admin/settings-form.tsx` |
| `admin-settings-save` | `components/admin/settings-form.tsx` |
| `admin-stats-csv` | `components/admin/overview.tsx` |
| `admin-thresholds` | `components/admin/settings-form.tsx` |
| `admin-totals` | `components/admin/overview.tsx` |
| `admin-user-row` | `components/admin/users.tsx` |
| `admin-users-role` | `components/admin/users.tsx` |
| `admin-users-status` | `components/admin/users.tsx` |
| `admin-users-table` | `components/admin/users.tsx` |
| `audit-action` | `components/admin/audit.tsx` |
| `audit-entity` | `components/admin/audit.tsx` |
| `audit-log` | `components/admin/audit.tsx` |
| `audit-row` | `components/admin/audit.tsx` |
| `badge-grant` | `components/admin/person-drawer.tsx` |
| `badge-label` | `components/admin/person-drawer.tsx` |
| `company-actions` | `components/admin/companies.tsx` |
| `company-auto-approve` | `components/admin/companies.tsx` |
| `company-domains` | `components/admin/companies.tsx` |
| `company-domains-dialog` | `components/admin/companies.tsx` |
| `company-list` | `components/admin/companies.tsx` |
| `company-row` | `components/admin/companies.tsx` |
| `company-suspend` | `components/admin/companies.tsx` |
| `company-unverify` | `components/admin/companies.tsx` |
| `company-verify` | `components/admin/companies.tsx` |
| `complaint-days` | `components/admin/complaints.tsx` |
| `complaint-dialog` | `components/admin/complaints.tsx` |
| `complaint-list` | `components/admin/complaints.tsx` |
| `complaint-note` | `components/admin/complaints.tsx` |
| `complaint-resolve` | `components/admin/complaints.tsx` |
| `complaint-row` | `components/admin/complaints.tsx` |
| `complaint-submit` | `components/admin/complaints.tsx` |
| `domain-evidence` | `components/admin/recruiters.tsx` |
| `domain-input` | `components/admin/companies.tsx` |
| `domain-list` | `components/admin/companies.tsx` |
| `domain-save` | `components/admin/companies.tsx` |
| `hide-rating-tool` | `components/admin/ratings.tsx` |
| `job-close` | `components/admin/jobs.tsx` |
| `job-row` | `components/admin/jobs.tsx` |
| `job-table` | `components/admin/jobs.tsx` |
| `person-badges` | `components/admin/person-drawer.tsx` |
| `person-ban` | `components/admin/person-drawer.tsx` |
| `person-drawer` | `components/admin/person-drawer.tsx` |
| `person-erase` | `components/admin/person-drawer.tsx` |
| `person-restore-profile` | `components/admin/person-drawer.tsx` |
| `person-role` | `components/admin/person-drawer.tsx` |
| `person-role-save` | `components/admin/person-drawer.tsx` |
| `person-suspend` | `components/admin/person-drawer.tsx` |
| `person-suspend-profile` | `components/admin/person-drawer.tsx` |
| `person-unban` | `components/admin/person-drawer.tsx` |
| `person-unsuspend` | `components/admin/person-drawer.tsx` |
| `person-warn` | `components/admin/person-drawer.tsx` |
| `quota-input` | `components/admin/recruiters.tsx` |
| `rating-hide` | `components/admin/ratings.tsx` |
| `rating-id` | `components/admin/ratings.tsx` |
| `rating-row` | `components/admin/ratings.tsx` |
| `reason-confirm` | `components/admin/admin-bits.tsx` |
| `reason-days` | `components/admin/admin-bits.tsx` |
| `reason-input` | `components/admin/admin-bits.tsx` |
| `reason-typed` | `components/admin/admin-bits.tsx` |
| `recruiter-approve` | `components/admin/recruiters.tsx` |
| `recruiter-queue` | `components/admin/recruiters.tsx` |
| `recruiter-quota` | `components/admin/recruiters.tsx` |
| `recruiter-reinstate` | `components/admin/recruiters.tsx` |
| `recruiter-reject` | `components/admin/recruiters.tsx` |
| `recruiter-row` | `components/admin/recruiters.tsx` |
| `recruiter-suspend` | `components/admin/recruiters.tsx` |
| `series-<id>` | `components/admin/overview.tsx` |
| `setting-<id>` | `components/admin/settings-form.tsx` |
| `setting-auto-approve` | `components/admin/settings-form.tsx` |
| `setting-import-enabled` | `components/admin/settings-form.tsx` |
| `setting-networkName` | `components/admin/settings-form.tsx` |
| `setting-premod` | `components/admin/settings-form.tsx` |
| `setting-provider` | `components/admin/settings-form.tsx` |
| `setting-registration` | `components/admin/settings-form.tsx` |
| `setting-timezone` | `components/admin/settings-form.tsx` |
| `settings-save-bar` | `components/admin/settings-form.tsx` |
| `stats-from` | `components/admin/overview.tsx` |
| `stats-to` | `components/admin/overview.tsx` |
