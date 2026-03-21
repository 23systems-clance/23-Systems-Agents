# Feature Specification: Gamification & Leaderboard System

**Feature Branch**: `24-gamification-leaderboard`
**Created**: 2026-03-14
**Status**: Draft
**Input**: User description: "Comprehensive gamification and leaderboard system with configurable scoring, achievements, and multi-channel Slack integration for BDR performance tracking"

## User Scenarios & Testing

### User Story 1 - BDR Views Daily Performance Leaderboard (Priority: P1)

A BDR wants to see how they rank against their peers based on today's activity to stay motivated and identify areas for improvement.

**Why this priority**: This is the core value proposition - providing visibility and motivation through transparent performance rankings. Without this, there's no gamification system.

**Independent Test**: Can be fully tested by having a BDR check the #sales-leaderboard-daily channel and seeing their rank, points, and activity breakdown (calls, meetings, emails). Delivers immediate value by making performance visible.

**Acceptance Scenarios**:

1. **Given** a BDR has completed 20 calls, 2 meetings, and 15 emails today, **When** they view the #sales-leaderboard-daily channel, **Then** they see their current rank with calculated points and activity metrics displayed
2. **Given** multiple BDRs have activity for the day, **When** the leaderboard updates (scheduled 4x/day), **Then** rankings are recalculated and displayed in descending point order with position indicators (🥇🥈🥉)
3. **Given** a BDR has improved their ranking, **When** the leaderboard updates, **Then** they see a visual indicator showing their position change (e.g., ↑3 for moving up 3 spots)
4. **Given** a BDR uses the `/leaderboard daily` slash command, **When** executed in any channel, **Then** they receive an ephemeral message showing current daily rankings visible only to them

---

### User Story 2 - Admin Configures Scoring Rules and Quality Gates (Priority: P2)

An admin needs to customize the gamification system to match company values - rewarding quality connections and meetings, not just call volume, while preventing gaming through minimum thresholds.

**Why this priority**: Ensures the gamification system aligns with business goals and prevents perverse incentives. Must be configurable before BDRs start competing to avoid unfair baseline.

**Independent Test**: Can be tested by admin accessing the admin dashboard, adjusting scoring weights (e.g., 30% activity, 50% quality, 20% outcomes), setting point values, and configuring quality gates. Verify that leaderboards recalculate using new rules.

**Acceptance Scenarios**:

1. **Given** an admin accesses the gamification settings dashboard, **When** they adjust scoring weight sliders (activity/quality/outcome), **Then** the weights must sum to 100% and update in real-time with a score preview
2. **Given** an admin sets point values (e.g., meeting_booked = 150 points), **When** they save the configuration, **Then** all future score calculations use the updated point values
3. **Given** an admin sets quality gates (min 15 calls/day, min 12% connection rate), **When** a BDR fails to meet these thresholds, **Then** they do not appear on the leaderboard regardless of points
4. **Given** an admin wants to test changes, **When** they click "Send Test Leaderboard", **Then** they receive a DM showing a preview leaderboard calculated with current settings

---

### User Story 3 - BDR Unlocks Achievements and Receives Recognition (Priority: P3)

A BDR wants to earn badges for hitting milestones (e.g., "100 Call Machine", "Perfect Week") to receive recognition and bonus points that contribute to their leaderboard ranking.

**Why this priority**: Adds engagement and celebration beyond daily rankings. Provides positive reinforcement for sustained effort and quality work. Lower priority than core leaderboard but enhances motivation.

**Independent Test**: Can be tested by simulating achievement criteria (e.g., BDR logs 100 calls in a day) and verifying that they receive a DM notification, public #sales-wins announcement, and bonus points are added to their score.

**Acceptance Scenarios**:

1. **Given** a BDR completes an action matching achievement criteria (e.g., 100 calls in one day), **When** the achievement checker runs, **Then** they receive a DM notification with achievement details and bonus points
2. **Given** a BDR unlocks a major achievement, **When** the achievement is awarded, **Then** a public message is posted to #sales-wins celebrating the accomplishment and showing team totals
3. **Given** an achievement is recurring (e.g., "Daily Target Hit"), **When** criteria are met multiple times, **Then** the BDR can unlock it repeatedly and earn points each time
4. **Given** an admin views the achievements library, **When** they toggle an achievement inactive, **Then** it can no longer be unlocked but existing unlocks remain in history

---

### User Story 4 - Team Leaderboards Show Client-to-Client Competition (Priority: P4)

BDRs want to see how their client team ranks against other client teams to foster team collaboration and friendly inter-client competition.

**Why this priority**: Builds team spirit and collaborative competition. Lower priority because individual leaderboards must exist first. Adds additional engagement layer for teams with multiple BDRs per client.

**Independent Test**: Can be tested by aggregating all BDR scores by their assigned client and displaying team leaderboards showing total points, team size, average points per BDR, and top performer per team.

**Acceptance Scenarios**:

1. **Given** multiple BDRs are assigned to the same client (via BdrClient junction), **When** team leaderboards are calculated, **Then** their points are aggregated under the client name
2. **Given** a team leaderboard is displayed, **When** viewing rankings, **Then** each team shows total points, member count, average points per BDR, and top performer name
3. **Given** a BDR clicks "Team View" button on the leaderboard, **When** the view switches, **Then** individual rankings are replaced with client-based team rankings
4. **Given** a client has only one BDR, **When** team leaderboards are shown, **Then** they still appear (team of 1) to ensure all BDRs are represented

---

### User Story 5 - Admin Creates and Manages Custom Channels for Leaderboards (Priority: P5)

An admin wants to choose which leaderboard channels to create (daily, weekly, monthly, achievements) to avoid overwhelming the workspace with channels if only daily rankings are needed.

**Why this priority**: Provides flexibility and prevents channel clutter. Lower priority because default recommendations (daily + wins) serve most use cases. Nice-to-have customization.

**Independent Test**: Can be tested by admin selecting which channels to create via checkboxes in admin dashboard, clicking "Create Selected Channels", and verifying only chosen channels are created with correct names and settings.

**Acceptance Scenarios**:

1. **Given** an admin selects "Daily Leaderboard" and "Wins & Achievements" checkboxes, **When** they click "Create Selected Channels", **Then** only #sales-leaderboard-daily and #sales-wins channels are created
2. **Given** channels have been created, **When** admin deselects a channel and saves, **Then** scheduled updates for that channel stop (no new posts) but channel remains accessible
3. **Given** an admin deletes a leaderboard channel manually, **When** the next scheduled update runs, **Then** the system detects missing channel and logs a warning without crashing
4. **Given** an admin selects weekly and monthly leaderboards, **When** configured, **Then** update schedules are registered (Monday 8am for weekly, 1st of month for monthly)

---

### Edge Cases

- **What happens when two BDRs have identical scores?**: Both BDRs share the same rank position. The next rank skips the appropriate number (e.g., two people tied for #2 means next person is #4).
- **What happens when a BDR has zero activity for the day?**: They do not appear on the daily leaderboard at all (quality gate: min 10 calls). Historical data remains but current day ranking is absent.
- **What happens when admin changes scoring weights mid-day?**: New weights apply to all future calculations but do not retroactively recalculate past days' scores. Current day scores recalculate on next update cycle.
- **What happens when a Slack channel is deleted manually?**: System detects missing channel on next update attempt, logs error to CloudWatch, skips posting to that channel, and DMs admin with recovery instructions.
- **What happens when BDR is assigned to multiple clients?**: For individual leaderboards, they appear once with total points. For team leaderboards, their points contribute to ALL teams they're assigned to (summed across each client).
- **What happens when achievement checker runs while BDR is completing an activity?**: Achievement checks run every 15 minutes. Activity completed between checks is evaluated on next cycle. No race conditions because checks query committed database records.
- **What happens when spam controls trigger?**: If more than 10 achievement posts occur within 1 hour to #sales-wins, additional achievements are batched and delivered in next hourly window with summary message.
- **What happens when timezone is changed?**: Daily leaderboard resets are calculated based on configured timezone. Changing timezone mid-day does not retroactively reset current day - reset happens at next midnight in new timezone.

## Requirements

### Functional Requirements

#### Leaderboard Core

- **FR-001**: System MUST calculate and display individual BDR rankings based on daily performance points
- **FR-002**: System MUST update daily leaderboards 4 times per day at configurable times (default: 8am, 12pm, 3pm, 5pm local time)
- **FR-003**: System MUST support weekly leaderboards showing cumulative performance for current week (Monday-Sunday)
- **FR-004**: System MUST support monthly leaderboards showing cumulative performance for current month
- **FR-005**: System MUST display team leaderboards aggregating BDR scores by assigned client (ManagedClient entity)
- **FR-006**: Leaderboard displays MUST show rank position, BDR name (mentionable), total points, and activity breakdown (calls, meetings, emails)
- **FR-007**: System MUST provide visual position indicators (🥇🥈🥉 for top 3, then numeric ranks)
- **FR-008**: System MUST show position change indicators (↑N, ↓N, NEW) when rankings shift between updates

#### Scoring System

- **FR-009**: System MUST calculate points using a weighted composite formula: (Activity Score × activity_weight) + (Quality Score × quality_weight) + (Outcome Score × outcome_weight)
- **FR-010**: System MUST allow admin to configure scoring weights via sliders that must sum to 100%
- **FR-011**: System MUST allow admin to configure point values for each activity type (calls, emails, LinkedIn, meetings, connections)
- **FR-012**: System MUST persist scoring configuration in workspace settings and apply consistently across all calculations
- **FR-013**: Activity Score MUST be calculated as: (calls_completed × call_points) + (emails_sent × email_points) + (linkedin_actions × linkedin_points)
- **FR-014**: Quality Score MUST be calculated as: (connection_rate × 100) + (calls_connected × connect_points)
- **FR-015**: Outcome Score MUST be calculated as: (meetings_booked × meeting_points)

#### Quality Gates

- **FR-016**: System MUST enforce configurable minimum daily calls threshold (default: 10 calls) to appear on leaderboard
- **FR-017**: System MUST enforce configurable minimum connection rate threshold (default: 10%) to appear on leaderboard
- **FR-018**: System MUST enforce configurable minimum active days per week (default: 4 days) to appear on weekly leaderboard
- **FR-019**: BDRs failing quality gates MUST be excluded from rankings regardless of point total
- **FR-020**: Admin MUST be able to view and edit all quality gate thresholds via admin dashboard

#### Channel Management

- **FR-021**: System MUST allow admin to select which leaderboard channels to create (daily, weekly, monthly, wins, compete)
- **FR-022**: System MUST create selected Slack channels on first-time setup with standardized naming (#sales-leaderboard-daily, #sales-wins, etc.)
- **FR-023**: System MUST auto-invite all active BDRs to created leaderboard channels
- **FR-024**: System MUST set channel topic and purpose describing the channel's function
- **FR-025**: System MUST track which channels are enabled in workspace settings and only post to enabled channels
- **FR-026**: System MUST handle channel deletion gracefully by detecting missing channels and logging errors without crashing
- **FR-027**: System MUST allow admin to disable channels after creation, stopping updates but preserving channel existence

#### Achievement System

- **FR-028**: System MUST support creating, editing, and deleting achievements via admin dashboard
- **FR-029**: Each achievement MUST have: name, description, emoji, category (volume/quality/outcome/streak/milestone), criteria, points reward, and active status
- **FR-030**: System MUST check achievement criteria every 15 minutes against current BDR performance data
- **FR-031**: System MUST send DM to BDR when achievement is unlocked showing achievement details and bonus points
- **FR-032**: System MUST post public announcement to #sales-wins for major achievements (configurable filter)
- **FR-033**: System MUST support recurring achievements that can be unlocked multiple times (e.g., daily targets)
- **FR-034**: System MUST prevent duplicate achievement unlocks within same time period for non-recurring achievements
- **FR-035**: Achievement points MUST be added to BDR's total score and reflected in leaderboard rankings
- **FR-036**: Admin MUST be able to seed default achievements (volume, quality, outcome, streak, milestone categories)

#### Streak Tracking

- **FR-037**: System MUST track daily call streaks (consecutive days hitting call targets)
- **FR-038**: System MUST track weekly quota streaks (consecutive weeks hitting targets)
- **FR-039**: System MUST display current streak days and longest streak days for each BDR
- **FR-040**: Streaks MUST reset when BDR fails to meet daily threshold (zero activity or below minimum calls)
- **FR-041**: Streak milestones (3-day, 7-day, 30-day) MUST trigger achievement unlocks automatically

#### Slash Command Interface

- **FR-042**: System MUST provide `/leaderboard` slash command accessible in any channel
- **FR-043**: `/leaderboard daily` MUST show ephemeral daily rankings visible only to requesting user
- **FR-044**: `/leaderboard weekly` MUST show ephemeral weekly rankings
- **FR-045**: `/leaderboard monthly` MUST show ephemeral monthly rankings
- **FR-046**: `/leaderboard team` MUST show ephemeral team rankings
- **FR-047**: `/leaderboard setup` MUST be admin-only and trigger channel creation flow
- **FR-048**: `/leaderboard help` MUST display usage instructions and available subcommands

#### Interactive UI

- **FR-049**: Leaderboard messages MUST include interactive buttons: [Daily] [Weekly] [Monthly] [Team View]
- **FR-050**: Clicking view buttons MUST update the message in place to show selected leaderboard type
- **FR-051**: Message updates MUST use `chat.update()` API to edit existing message rather than posting new one

#### Admin Dashboard

- **FR-052**: Admin dashboard MUST have 5 tabs: Channels & Scheduling, Scoring Rules, Quality Gates, Achievements, Preview & Testing
- **FR-053**: Channels & Scheduling tab MUST display channel selection checkboxes, status indicators, update schedule builder, and timezone selector
- **FR-054**: Scoring Rules tab MUST display weight sliders (summing to 100%), point value inputs, and real-time score preview
- **FR-055**: Quality Gates tab MUST display editable threshold inputs with explanatory tooltips
- **FR-056**: Achievements tab MUST display achievement library table with CRUD controls, active/inactive toggles, and seed defaults button
- **FR-057**: Preview & Testing tab MUST show live leaderboard preview, test leaderboard button, and settings export/import
- **FR-058**: All admin changes MUST save to workspace settings (JSONB field in database)
- **FR-059**: Admin MUST be able to send test leaderboard DM to themselves for preview before full deployment

#### Data Persistence

- **FR-060**: System MUST persist daily performance snapshots (calls, emails, LinkedIn, meetings, connection rate, points) per BDR per day
- **FR-061**: System MUST persist all achievement unlocks with timestamp for historical tracking
- **FR-062**: System MUST persist streak data (current days, longest days, last active date) per BDR per streak type
- **FR-063**: System MUST persist channel mappings (channel ID, channel type, last message timestamp) for message updates
- **FR-064**: System MUST link performance data to client (ManagedClient) for team aggregation

#### Spam Controls

- **FR-065**: System MUST limit leaderboard updates to max 1 per 5 minutes per channel
- **FR-066**: System MUST limit achievement posts to max 10 per hour to #sales-wins
- **FR-067**: System MUST batch minor achievements hourly when spam threshold is reached
- **FR-068**: System MUST provide configurable spam control levels (off, moderate, strict) in admin settings

#### Data Aggregation

- **FR-069**: System MUST aggregate daily activity data from: DailyBdrActivity (emails, LinkedIn, calls), CallSession (power dialer calls, connection rates), CampaignContact (meetings booked)
- **FR-070**: System MUST calculate connection rate as: calls_connected / calls_completed
- **FR-071**: System MUST recalculate rankings whenever scores change (scheduled updates or achievement unlocks)
- **FR-072**: Team rankings MUST aggregate individual BDR scores by clientId, showing: team total points, member count, average points per BDR, top performer

### Key Entities

- **BDR Performance Record**: Represents daily performance snapshot for a BDR containing activity counts (calls, emails, LinkedIn, meetings), quality metrics (connection rate, conversion rate), calculated total points, and ranking positions (daily/weekly/monthly)

- **Achievement**: Represents a badge or milestone that can be unlocked, containing name, description, emoji, category, criteria (as structured data), points reward, recurring flag, and active status. Related to multiple BDR Achievement Unlocks.

- **BDR Achievement Unlock**: Represents a specific instance of a BDR earning an achievement, containing BDR reference, achievement reference, and unlock timestamp. Supports recurring achievements through multiple unlock records.

- **Leaderboard Channel Mapping**: Represents a Slack channel created for gamification, containing channel ID, channel type (daily/weekly/monthly/wins/compete), channel name, last message timestamp (for in-place updates), and last updated time.

- **Streak Tracker**: Represents BDR's streak progress for a specific streak type (daily_calls, weekly_quota, meetings_booked), containing current streak days, longest streak days, and last active date.

- **Workspace Gamification Settings**: Represents admin-configured gamification rules stored in workspace settings, containing enabled channels array, scoring weights (activity/quality/outcome percentages), point values (per activity type), quality gate thresholds, update schedule times, timezone, and spam control level.

## Success Criteria

### Measurable Outcomes

- **SC-001**: At least 80% of active BDRs check the leaderboard daily (measured by channel view count or slash command usage)
- **SC-002**: Average daily call volume per BDR increases by at least 15% within 30 days of gamification launch
- **SC-003**: Average meetings booked per BDR per week increases by at least 10% within 30 days of gamification launch
- **SC-004**: Leaderboard updates complete successfully at least 99% of scheduled times (4x/day for daily, weekly, monthly)
- **SC-005**: Achievement notification delivery rate is at least 99% (DMs sent successfully within 5 minutes of unlock)
- **SC-006**: Zero spam complaints from users about excessive notifications (measured by support tickets or direct feedback)
- **SC-007**: Admin can configure all scoring rules and quality gates in under 10 minutes without technical assistance
- **SC-008**: BDRs can view their current ranking in under 5 seconds using slash command
- **SC-009**: System supports at least 100 concurrent BDRs without performance degradation (leaderboard queries <500ms)
- **SC-010**: Connection rate among BDRs improves by at least 5% within 60 days (indicating quality focus over volume)
- **SC-011**: At least 70% of BDRs unlock at least one achievement per week (indicating active engagement)
- **SC-012**: Team leaderboards are viewed by at least 50% of BDRs weekly (measured by button clicks or slash command usage)

## Assumptions

- BDRs have Slack access and use it daily as primary communication tool
- Admin has necessary permissions to create channels and configure workspace settings
- OAuth scope `channels:manage` can be added to existing workspace installation without breaking changes
- DailyBdrActivity data is already being tracked for emails, LinkedIn, and calls (existing feature)
- Power dialer CallSession data will be available when power dialer feature launches (Feature 22)
- CampaignContact status changes indicate meetings booked (existing workflow)
- BDRs are assigned to clients via BdrClient junction table (existing data model)
- Workspace has at least 5 active BDRs to make leaderboards meaningful (minimum viable competition)
- Slack API rate limits are sufficient for 4x/day updates across multiple channels
- Redis cache is available for conversation state and temporary data
- BullMQ queue system is operational for scheduled jobs
- CloudWatch logs are configured for monitoring and alerting

## Dependencies

- **Feature 22 (Power Dialer)**: Connection rate and call quality metrics depend on CallSession data from power dialer. Gamification can launch with partial metrics (emails, LinkedIn, manual call logs) but full quality scoring requires power dialer integration.
- **OAuth Re-authorization**: Existing workspace installations must re-authorize with updated scopes (`channels:manage`) before channel creation can succeed.
- **Admin Dashboard Deployment**: Frontend changes must be deployed to S3/CloudFront after backend API routes are implemented.
- **Slack Bolt Framework**: Socket Mode connection must remain stable; multiple concurrent connections cause event splitting and state issues.
- **Prisma Migrations**: Database schema changes must be applied to production before gamification features can store data.

## Out of Scope

- **Multi-workspace support**: v1 focuses on single workspace; cross-workspace leaderboards deferred to future iteration
- **Reward redemption system**: Points store where BDRs redeem points for prizes (PTO, gift cards) is not included in v1
- **Historical trend charts**: Visual performance graphs over time deferred to analytics dashboard feature
- **Manager-specific dashboards**: Dedicated manager views with team drill-downs deferred to future iteration
- **Custom challenges**: Head-to-head 1v1 or team battles with prize pools not included in v1
- **Predictive analytics**: ML models predicting quota attainment based on early-week activity not included
- **Mobile app integration**: Leaderboards are Slack-only; dedicated mobile app not in scope
- **External integrations**: Exporting leaderboard data to third-party tools (Salesforce, HubSpot dashboards) not included
- **Voice/video achievements**: Recognizing achievements through Slack Huddles or video calls not included
- **Localization**: Multi-language support for leaderboard messages and admin UI not included in v1
