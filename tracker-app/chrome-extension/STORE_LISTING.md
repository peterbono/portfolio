# Chrome Web Store Listing — JobTracker - Auto Apply

## Store Listing Fields

### Name
JobTracker - Auto Apply

### Short Description (132 chars max)
Auto-apply to jobs on LinkedIn Easy Apply and 15+ ATS platforms. Discover, review, and submit applications from one dashboard.

### Detailed Description
JobTracker connects your LinkedIn account to a smart job search dashboard. It auto-discovers matching jobs, lets you review them, and applies on your behalf — across LinkedIn Easy Apply and 15+ external ATS platforms.

How it works:
1. Install the extension and connect your LinkedIn account (one click)
2. Set your job search criteria in the JobTracker dashboard
3. The bot discovers and scores matching jobs using AI
4. Review matches in a card-stack UI — approve, skip, or reject
5. Approved jobs are submitted automatically via Easy Apply or external ATS forms

Supported platforms:
- LinkedIn Easy Apply
- Greenhouse
- Lever
- Workable
- Ashby
- Teamtailor
- SmartRecruiters
- BambooHR
- Recruitee
- Breezy HR
- iCIMS
- Jobvite
- Workday
- And more

Your data stays in your browser. We never collect, transmit, or store your credentials. The extension only reads your existing LinkedIn session cookie to search and apply on your behalf.

Dashboard: https://tracker-app-lyart.vercel.app
Privacy policy: https://tracker-app-lyart.vercel.app/privacy-extension.html

### Category
Productivity

### Language
English

---

## Permission Justifications (for CWS review)

| Permission | Justification |
|-----------|---------------|
| cookies | Read LinkedIn session cookie (li_at) to verify user is logged in and authenticate job searches |
| storage | Store extension connection state, apply results, and user preferences locally |
| tabs | Open job application pages in new tabs and navigate between LinkedIn/ATS pages during apply flow |
| scripting | Inject form-filling scripts into ATS application pages to auto-complete job applications |
| host: linkedin.com | Access LinkedIn job listings and Easy Apply forms |
| host: greenhouse.io | Fill and submit Greenhouse job application forms |
| host: lever.co | Fill and submit Lever job application forms |
| host: workable.com | Fill and submit Workable job application forms |
| host: (other ATS) | Fill and submit job applications on respective ATS platforms |
| host: tracker-app-lyart.vercel.app | Bridge communication between dashboard web app and extension |

---

## Screenshots to Prepare

1. **Dashboard overview** — Autopilot view with job cards, scores, and review queue
2. **Extension popup** — Connected state showing LinkedIn connection
3. **Job review card** — Card-stack UI showing job details and match score
4. **Apply in progress** — Extension filling a Greenhouse/Lever form
5. **Results summary** — After a scan showing jobs found/qualified/applied

---

## Submission Checklist

- [x] manifest.json cleaned (no localhost, no debugger, no Gmail)
- [x] Privacy policy hosted at tracker-app-lyart.vercel.app/privacy-extension.html
- [x] ZIP package ready: ~/Desktop/jobtracker-extension-v3.3.0.zip (74KB)
- [x] Extension banner added to dashboard (detects + prompts install)
- [ ] Create Chrome Web Store developer account ($5 fee)
- [ ] Upload ZIP to https://chrome.google.com/webstore/devconsole
- [ ] Fill store listing fields (copy from above)
- [ ] Take and upload 5 screenshots (1280x800 or 640x400)
- [ ] Submit for review (typically 1-3 business days)
- [ ] After approval: update ExtensionBanner.tsx with real CWS URL + flip IS_CWS_LIVE = true
