---
name: youtube-transcript
description: Fetch transcripts from YouTube videos for summarization and analysis.
---

# YouTube Transcript

Fetch transcripts from YouTube videos.

## Setup

```bash
cd skills/youtube-transcript
npm install
```

## Usage

```bash
skills/youtube-transcript/transcript.js <video-id-or-url>
```

Accepts video ID or full URL:
- `EBw7gsDPAYQ`
- `https://www.youtube.com/watch?v=EBw7gsDPAYQ`
- `https://youtu.be/EBw7gsDPAYQ`

## Output

Timestamped transcript entries:

```
[0:00] All right. So, I got this UniFi Theta
[0:15] I took the camera out, painted it
[1:23] And here's the final result
```

## Proactive Detection

When the user sends a message containing a YouTube URL (youtube.com/watch, youtu.be, or a bare video ID in a YouTube context), proactively ask: **"Would you like me to transcribe this video?"** before proceeding. If they confirm, run the transcript command and return the output.

## Saving Transcripts

After fetching a transcript, always save the full output to:

```
references/Youtube Transcripts/MMDD - [ChannelName] Video Title.md
```

- **MMDD** — today's date (e.g., `0319` for March 19)
- **ChannelName** — the YouTube channel name (fetch from the page if possible, otherwise ask the user)
- **Video Title** — the video's title

If the channel name or title can't be determined automatically, ask the user.

## Saving Summaries

After saving the transcript, also generate an HTML summary and save it to:

```
references/Youtube Summaries/MMDD - [ChannelName] Video Title.html
```

Use the same `MMDD - [ChannelName] Video Title` naming convention as transcripts.

### Summary Templates

Three templates are available in `references/SOP Templates/`:

| Template | File | Best For |
|----------|------|----------|
| **Executive** | `youtube-summary-executive.html` | Quick overview: summary, numbered takeaways, topic grid, quotes |
| **Detailed** | `youtube-summary-detailed.html` | Deep dive: sidebar nav, stats, per-topic breakdown with bullets, action items, supporting quotes |
| **Compact** | `youtube-summary-compact.html` | Single-column notes: TL;DR, pill-style takeaways, timeline topic rows |

Default to **Detailed** unless the user requests a different format.

### Clickable Timestamps

All timestamps in summaries must link directly to that point in the YouTube video using the `&t=XXs` parameter (total seconds). For example, `3:45` links to `{{VIDEO_URL}}&t=225s`. This lets the user click any topic or quote to jump to that section of the video.

### Summary Content

When generating a summary, include:
1. **Executive summary / TL;DR** — 2-3 sentences covering the main thesis
2. **Key takeaways** — 3-7 numbered insights with a title and description each
3. **Topics covered** — each with a timestamp range (clickable) and brief description
4. **Notable quotes** — best 2-4 quotes with timestamps (clickable)
5. **Action items** (detailed template only) — practical next steps from the content

## Notes

- Requires the video to have captions/transcripts available
- Works with auto-generated and manual transcripts
