# Pottery App — Project Plan

## Overview
A web app for potters/ceramicists to track their pieces, materials (clay + glazes), firings, and sales. Built to work on all devices (phone, tablet, desktop). Designed by a potter, for potters.

## Name
TBD — Christina is deciding. Top candidates: KilnLog, ClayMate, GlazeBook, MudLog

## Tier Structure

### Free — "Basic"
- Track up to 20 pieces
- 1 photo per piece
- Personal clay body library
- Personal glaze library (commercial glazes)
- Basic search
- Works on all devices

### Mid Tier — ~$TBD/month
- Unlimited pieces
- Unlimited photos per piece (lifecycle timeline: wet → leather hard → bisque → glazed → final)
- Glaze recipe book (for potters who mix their own)
- Firing logs (cone, kiln, schedule, atmosphere, results)
- Cost tracking per piece
- Multi-studio tagging
- Export/print (physical journal output)
- Advanced search & filtering

### Top Tier — ~$TBD/month
- Everything in Mid
- **Community Glaze Library** — browse and share:
  - Commercial glaze combos with photos of results
  - Glaze recipes (from-scratch formulations)
  - Tagged by clay body, cone, atmosphere, application method
  - Photos of actual fired results
- **Sales tracking** — log sales, track revenue, see what sells

## Tech Stack
- **Frontend:** React (responsive, works on all devices)
- **Backend:** Node.js + Express
- **Database:** SQLite for v1 (simple, portable, can migrate later)
- **Auth:** Simple email/password to start
- **Hosting:** Static frontend + API server
- **Photos:** Local storage for v1, cloud storage later

## Core Data Model

### Piece
- id, title, description
- photos[] (with stage labels)
- clay_body_id (FK)
- glazes[] (which glazes, coats, application method)
- firing_log_id (FK, optional)
- studio (where it was made)
- status (in-progress, bisque, glazed, done, sold)
- cost (materials + firing)
- sale_price (if sold)
- dates (created, modified, sold)
- notes

### Clay Body
- id, name, brand/supplier
- color (wet, fired)
- cone range
- type (stoneware, porcelain, earthenware, etc.)
- notes

### Glaze
- id, name
- type (commercial | recipe)
- brand (if commercial)
- color description
- cone range
- atmosphere (oxidation, reduction, neutral)
- recipe (if type=recipe: ingredients + percentages)
- notes

### Glaze Combo
- id, name
- glazes[] (ordered layers, with coats + method per layer)
- clay_body_id (what it was tested on)
- firing info (cone, atmosphere)
- photos[] (actual results)
- notes
- shared (boolean — in community library or not)

### Firing Log
- id, date
- kiln name/location
- cone / temperature
- atmosphere (oxidation, reduction)
- schedule/ramp notes
- results/notes

### Sale
- id, piece_id
- date, price
- venue (online, art fair, gallery, etc.)
- buyer notes (optional)

## Status
- [ ] v1 build — in progress
- [ ] Show to Christina for feedback
- [ ] Name + pricing finalized
- [ ] Iterate based on feedback
