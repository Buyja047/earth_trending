# NASA Space Apps 2026: plan, rules and submission kit

Монгол хураангуй доор байна (§ Монгол).

Everything in this file was checked on 2026-11-04 against the sources named
in § Sources. Where a source could not be reached from the build environment
(spaceappschallenge.org refused connections), the line says so and names
the single check that settles it.

## 1. The facts the plan rests on

| Fact | Value | Source | Confidence |
|---|---|---|---|
| Hackathon dates | **14–15 November 2026** (local time of the Local Event); submission closes 15 Nov 23:59 local | Space Apps blog "Explore The Next Frontier"; participant FAQ; several local-event pages | High (all sources agree) |
| Challenge | **"Be an Earth System Trend Detective!"**: "Create software to visualize and evaluate Earth science data to identify global environmental trends over time." Intermediate/advanced. The four questions: what is changing, where, how much, is it significant | NASA Earthdata event listing; the challenge page itself could not be fetched (HTTP 503 from here) | High for the summary; **check the full statement** at spaceappschallenge.org/2026/challenges/ for Objectives and Potential Considerations |
| Challenge resources | Published **13 November 2026** with the Project Submission Guide | Participant FAQ | High |
| Judging criteria | **Impact, Creativity, Validity, Relevance, Presentation** (equal weight; the guide asks for "equal attention" to Presentation) | 2022 Judging & Awards Guide (PDF, the last one readable from here); secondary 2024–2025 sources list the same five | High: unchanged 2019–2025; confirm in the 2026 guide on 13 Nov |
| Global Awards | Best Use of Science · Best Use of Data · Best Use of Technology · Galactic Impact · Best Mission Concept · Most Inspirational · Best Storytelling · Global Connection · Art & Technology · Local Impact | 2022 guide; 2025 awards pages | High |
| Team size | 1–6; all members registered on the project page before submission closes | 2022 guide | High |
| Language | Project page in English; a demo video may be in another language **with English subtitles** | 2022 guide | High |
| **Pre-work rule** | The 2026 participant FAQ: *teams are not allowed to begin working on the challenges prior to the hackathon*. The 2022 FAQ phrased it as "we ask that participants start the actual work when the hackathon begins." | Participant FAQ (search snippet; page itself 503 from here); 2022 legacy FAQ | **This is the fact the plan rests on. Read the FAQ and the 13 Nov Project Submission Guide yourself before deciding how to describe the project.** |
| Originality checkbox | "I confirm that the submitted project represents my team's original work and that all external resources including code, text and images (even if they are open source or freely available) used in the solution are listed in the References field" | 2022 guide (same checkbox expected in 2026) | High |

## 2. What this means for a repository that already exists

This repository is public and dated: the first commit is 27 October 2026,
and the case files were added on 4 November. Nothing can make that work
"created during the hackathon", and nothing in it should pretend to be.

The honest and, we believe, compliant path:

1. **Disclose the pre-existing tool.** On the project page, under References,
   list this repository with its date and tag (`v1.0-pre-hackathon`, see
   § 5), exactly as one lists any open-source library. The originality
   checkbox is about listing external resources, and a team's own earlier
   open-source work is such a resource.
2. **Make the hackathon project a clearly scoped increment** built during
   14–15 November, described as such on the project page ("During the
   hackathon we built …"). Section 4 lists what that increment should be.
3. **Do not merge or stage anything on the weekend that was written before
   it** and then describe it as weekend work. That is the one thing that
   would turn a disclosed resource into a false statement.
4. **Residual risk:** a strict reading of the FAQ could treat any prior
   work on the challenge as disqualifying, however it is disclosed. If the
   13 Nov Project Submission Guide says that, the fallback is to submit
   only the weekend increment as the project, with the tool as a cited
   dependency, and to say so plainly to the Local Lead before submitting.

## 3. Where the tool stands against the five criteria (self-assessment)

| Criterion | Now | Weakest point | What moves it |
|---|---|---|---|
| Validity | Strong: autocorrelation-corrected Mann-Kendall, FDR across the map, detectability year, step tests at documented data changes, Monte Carlo and a known-truth field; cross-checks against NSIDC, GPM IMERG, MODIS snow, Sentinel-5P | Long-memory noise is a known limit | Nothing before the weekend; keep the Method tab honest |
| Relevance | Answers the four questions for every cell; global and Mongolian datasets; live analysis of 1,320 NASA POWER variables | The default view was Mongolia; "global" is the challenge's word | Case files open with a global case; add global cases from the 13 Nov resources |
| Impact | Mongolia hazards (dust, snow, heavy rain, fire) with risk zones, mine downwind roses, Earth Engine fire maps; offline, bilingual, phone-capable | No named user or decision | Name the users (NEMA/ОБЕГ, aimag emergency departments, herders' cooperatives, mine EHS) and the decision each case informs |
| Creativity | "Not yet detectable" instead of "no trend"; data traps found and explained; the detective framing made literal in the case files | | Keep the detective voice in the video and page |
| Presentation | Was the weakest: a 10-step guide and a dense workbench | | Case files (done), the 30-second video, a short project page (§ 6) |

## 3b. Built before the weekend (disclosed as prior work)

Besides the case files: a "your own case" generator on top of the live
analysis (any NASA POWER variable, any box, presented as a five-step case),
the dzud-ingredients case, verdict cards as PNG, a what-if detectability
slider, a bilingual glossary, QR codes for every step, a regime-shift layer,
step tests at documented transitions in live scenes, an offline copy of
the hosted site (service worker), and the `modis-trend` pipeline for 1 km /
5 km MODIS scenes (docs/MODIS_TRENDS.md). All of it is dated in the
repository history and listed in README; it goes under References with the tag.

## 4. The hackathon weekend: what to build in 48 hours

Priorities in order. Stop when the clock says so; everything below the first
three is optional. With the tooling above in place, the weekend is about
NASA's own resources, new cases, and the presentation.

1. **Read the 13 Nov resources and the full challenge statement first** (1 h).
   If NASA names datasets, add at least one of them as a live or precomputed
   scene and write a case file for it: a case is 40–60 lines of `cases.js`
   and needs no new UI.
2. **Two or three new case files** from the data NASA points to, each ending
   in a verdict with live evidence. Candidates that the existing pipeline can
   serve today: global soil wetness (drying/wetting), global precipitation
   (wet-dry), a hemisphere comparison of sea ice, any NASA POWER variable
   over any region the team cares about (the live analysis reads 472
   MERRA-2 and 848 CERES variables).
3. **The 30-second video and the project page** (§ 6, § 7). Record the
   case files, not the workbench. Presentation is a fifth of the score.
4. **One Earth Engine fire map for a current date** (if a team member has an
   Earth Engine project): one command, and the fire case shows the new date.
5. Optional polish: a "share this verdict" image export; a Mongolian video
   with English subtitles; a NEMA-style one-page hazard brief generated
   from a case.

Division of labour (a team of 3–5): one person on NASA resources and new
scenes (Python), one on case texts in both languages, one on the video and
project page, one on testing on phones and on a clean machine (unzip, double
click, no internet).

## 5. Before the weekend (allowed: set-up, not challenge work)

- Tag the repository: `git tag -a v1.0-pre-hackathon -m "state before Space Apps 2026"` and push the tag; put the tag in References.
- Register every team member and the team on spaceappschallenge.org; choose the Local Event (Ulaanbaatar if one is listed; otherwise the Universal Event).
- Install Python 3.13, `pip install -r requirements.txt`, run `python -m pytest -q`; install `earthengine-api` and authenticate for whoever will run `fire-map`.
- Confirm NASA POWER on AWS is reachable from the venue network (the live analysis needs it); if not, the precomputed scenes still work offline.

## 6. Thirty-second video storyboard (one case, no narration of menus)

| s | Screen | Voice (English, or Mongolian with English subtitles) |
|---|---|---|
| 0–4 | Case board | "Is the planet warming? Is Antarctic sea ice growing? Trend Detective answers from NASA data, step by step." |
| 4–12 | Case "Antarctic sea ice", steps 1–2 | "MERRA-2 says Antarctic ice is growing. The satellite record says it is not. Subtract one from the other …" |
| 12–20 | Step 3, the steps layer; the evidence line | "… and a jump appears in January 2005, the day the model's sea-ice input changed. Found in the data first, matched to the documentation after." |
| 20–26 | Verdict card; then "Is Mongolia warming" spring map | "Every verdict says what, where, how much, how sure, and when we will know. In Mongolia: spring is warming; winter is not." |
| 26–30 | Phone, offline, Mongolian | "Runs in a browser, offline, in two languages. Open a case." |

## 7. Project page: draft fields (English, ≤ 250 words each where the form limits)

**Project name.** Trend Detective: case files from NASA data

**High-level summary.** Trend Detective turns the four questions of the
challenge into case files: guided investigations where every number is
computed live from NASA data in the browser. It tests every grid cell with an
autocorrelation-corrected Mann-Kendall test, controls false discoveries across
the map, says "not yet detectable" instead of "no trend", and checks each
dataset against an independent record. Ten cases ship today, from global
warming and a sea-ice data artifact to Mongolia's dust, rain and fire hazards,
and four more at 1 km open with the MODIS scenes;
a new case is a page of text, not new code. It works offline, on phones, in
English and Mongolian.

**How we addressed the challenge.** What: Sen slope per cell. Where: FDR-tested
maps, risk zones. How much: slopes with 95 % intervals and area means. Is it
significant: corrected p, FDR, a second parametric test, Monte Carlo validation
and a known-truth field; plus the year the trend becomes detectable.

**How we developed it.** Python pipeline (NASA POWER Zarr on AWS, NSIDC, GES
DISC, Earth Engine) → compact payloads → a dependency-free browser workbench;
the same statistics implemented in Python and JavaScript and tested to agree.

**Use of AI.** State exactly which parts were written with AI assistance (this
repository's history shows commits authored with Claude), as the form asks.

**NASA data.** NASA POWER v10 (MERRA-2, CERES SYN1deg, GPM IMERG); GIBS
imagery; Landsat Collection 2 and ERA5-Land via Earth Engine; NSIDC Sea Ice
Index; MODIS (snow, dust); Sentinel-5P (DLR L3). Full table: docs/DATA_LICENSES.md.

**References.** This repository and tag; every dataset DOI/URL in
docs/DATA_LICENSES.md; statistical references in docs/METHODS.md; fzstd
(MIT); world-atlas (ISC); GeoNames (CC BY 4.0).

## 8. Sources

- Space Apps 2026 dates and theme: https://www.spaceappschallenge.org/blog/explore-the-next-frontier-at-the-2026-nasa-space-apps-challenge/ (via search; page returned 503 from the build environment).
- Participant FAQ (pre-work rule, 13 Nov resources): https://www.spaceappschallenge.org/resources/participant-faqs/ (via search snippet; page returned 503 from here). 2022 wording: https://legacy.spaceappschallenge.org/resources/faq/
- Challenge summary: https://www.earthdata.nasa.gov/events/2026-nasa-space-apps-challenge (search snippet). Challenge page: https://www.spaceappschallenge.org/2026/challenges/ (503 from here).
- Judging criteria and awards: Space Apps 2022 Judging & Awards Guide (PDF, spaceapps-prod.s3.amazonaws.com), read in full; 2025 criteria reported identically by Romania Journal and Space Apps Sarawak.
- Competing 2026 entries seen in public repositories (for positioning only): entitySource/trend_detective (Mann-Kendall + FDR, MapLibre), nasa-earth-detectives (3D globe, .NET), GOHSUNJIN/TerraTrend, nabeulislam/orion-space.

---

## Монгол

**Огноо.** Space Apps 2026 **11-р сарын 14–15**-нд болно; төслийг 15-ны 23:59 (орон нутгийн цагаар) хүртэл илгээнэ. Сорилтын нэмэлт материал, Төсөл илгээх заавар **11-р сарын 13**-нд нийтлэгдэнэ.

**Сорилт.** «Be an Earth System Trend Detective!»: дэлхийн шинжлэх ухааны өгөгдлийг дүрслэн үзүүлж, үнэлж, цаг хугацааны явцад дэлхийн хэмжээний байгаль орчны чиг хандлагыг илрүүлэх програм хангамж бүтээх. Дөрвөн асуулт: юу өөрчлөгдөж байна, хаана, хэр их, ач холбогдолтой юу.

**Шалгуур** (тэнцүү жинтэй): Impact (нөлөө), Creativity (шинэлэг байдал), Validity (шинжлэх ухааны үндэслэл), Relevance (сорилтод нийцсэн байдал), Presentation (танилцуулга). Удирдамж танилцуулгад «ижил анхаарал» хандуулахыг шаарддаг.

**Урьдчилсан ажлын дүрэм.** 2026 оны албан ёсны FAQ: *багууд хакатоноос өмнө сорилт дээр ажиллаж эхлэхийг хориглоно.* Энэ агуулах нийтийн бөгөөд огноотой (эхний commit 10-р сарын 27). Шударга зам: (1) төслийн хуудасны References хэсэгт энэ агуулахыг огноо, tag-тай нь бусад нээлттэй эхийн сан шиг бүртгэх; (2) хакатоны төслийг 14–15-нд бүтээсэн тодорхой нэмэлт болгон тодорхойлох; (3) амралтын өдрүүдэд өмнө нь бичсэн зүйлийг нэгтгээд «амралтын өдрийн ажил» гэж бичихгүй байх. **Үлдэгдэл эрсдэл:** FAQ-г хатуу уншвал урьдчилсан ажил нь тайлбарласан ч хасагдах шалтгаан болж болно. 11-р сарын 13-ны Төсөл илгээх зааврыг заавал уншиж, Local Lead-тэй урьдчилан ярилцаарай.

**48 цагт юу хийх вэ** (дарааллаар): 11-р сарын 13-ны материалыг уншина (1 цаг) → NASA-гийн заасан өгөгдлөөс 2–3 шинэ хэргийн хавтас (`cases.js`-д 40–60 мөр, шинэ UI хэрэггүй) → 30 секундын видео ба төслийн хуудас (§ 6, § 7) → боломжтой бол тухайн өдрийн Earth Engine түймрийн зураг → нэмэлт өнгөлгөө.

**Амралтын өдрөөс өмнө** (зөвшөөрөгдсөн бэлтгэл): `v1.0-pre-hackathon` tag үүсгэж push хийх; багийн гишүүн бүрийг бүртгүүлэх; Python 3.13 + `requirements.txt` суулгаж тест ажиллуулах; Earth Engine-д нэвтрэх; газар дээрх сүлжээнээс NASA POWER (AWS) руу холбогдож байгаа эсэхийг шалгах.
