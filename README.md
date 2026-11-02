# Event Report PWA

Offline-first Progressive Web App for security staff to fill in event / work reports in the field — with signature, photos and PDF export — plus an admin dashboard. Deployed in white-label versions for several clients.

> Screenshots: add images to a `docs/` folder and link them here.

## Features
- **Field report form** – event details, staff, incidents, on-screen signature, ID/ticket photo upload.
- **Offline mode** – Service Worker + local queue; reports sync automatically when back online.
- **Admin dashboard** – PIN-protected; list, filter, view and update reports.
- **Report view & export** – printable view, PDF/image export (html2canvas + jsPDF).
- **Secure admin API** – Supabase Edge Functions; admin token signed server-side, service-role key only on the server.

## Tech stack
HTML · CSS · Vanilla JavaScript · Service Worker (PWA) · Supabase (Postgres, Storage, Edge Functions in TypeScript/Deno)

## Structure
```
├── index.html, report.html, report-view.html, admin-login.html, admin.html
├── sw.js                     # service worker
├── js/  report.js · offline.js · admin.js · auth-*.js · supabase.js
└── supabase/functions/       # admin-auth, admin-list-reports, admin-get-report, admin-update-report
```

## Setup
1. Deploy the Edge Functions and set secrets: `ADMIN_PIN`, `ADMIN_JWT_SECRET`.
2. Set your Supabase URL and anon key in `js/supabase.js`.
3. Deploy the static files (Netlify).
