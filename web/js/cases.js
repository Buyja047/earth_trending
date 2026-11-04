/* Case files: guided investigations through the workbench.
 *
 * A case is a question about the Earth system answered step by step. Each step is a declarative
 * state of the viewer (dataset, years, months, layer, selection, tab) plus a short text. The
 * "evidence" line under a step is computed from the results on screen at that moment; no number
 * in it is typed in, so it stays right when the data are rebuilt. The last step is a verdict:
 * what is changing, where, how much, whether it is significant, when we will know, and caveats.
 *
 * The definitions are plain data (bilingual), so tests/test_cases.py can check them in node
 * without a browser; the engine at the bottom only runs in the page, through window.TDApp. */
(function (root) {
  "use strict";
  const B = (en, mn) => ({ en, mn });
  const LAYERS = ["trend", "naive", "verdict", "detect", "emerge", "zone", "anom", "steps", "truth", "shift"];
  const SEASONS = ["all", "djf", "mam", "jja", "son", "ndjfm", "mjjas", ...Array.from({ length: 12 }, (_, k) => "m" + (k + 1))];
  const TABS = ["map", "analysis", "screen", "method"];
  const ACTION_KEYS = ["scene", "risk", "years", "season", "alpha", "layer", "tab", "view", "compare", "place", "box", "zoom", "sel"];
  const TAGS = ["global", "mongolia", "trap", "hazard", "method"];

  // ------------------------------------------------------------ small helpers for evidence text
  const pct = (x, d = 0) => (100 * x).toFixed(d) + " %";
  // "rising" / "falling" / "no detectable trend", from a Sen slope and its corrected p
  function trendWord(c, s) {
    if (!s || !Number.isFinite(s.sen)) return B("no estimate", "тооцоо алга");
    if (!(s.p_mk < c.alpha)) return B("no detectable trend", "илрэх чиг алга");
    return s.sen > 0 ? B("rising", "өсөж байна") : B("falling", "буурч байна");
  }
  const ci = (c, s) => `${c.fmt(s.sen_lo)}…${c.fmt(s.sen_hi)}`;
  // one area mean's sentence: "+0.194 °C per decade (95 % CI 0.0703…0.32, corrected p 0.002)"
  const meanLine = (c, s, u) => B(
    `${c.signed(s.sen)} ${u} per decade (95 % CI ${ci(c, s)}, corrected p ${c.fmtP(s.p_mk)})`,
    `арван жилд ${c.signed(s.sen)} ${u} (95 % итгэлийн завсар ${ci(c, s)}, засварласан p ${c.fmtP(s.p_mk)})`);
  const cellsLine = (c) => B(
    `${c.nf(c.k.fdr)} of ${c.nf(c.k.valid)} cells significant after FDR (${c.nf(c.k.fdr_up)} up, ${c.nf(c.k.fdr_down)} down); a naive test would flag ${c.nf(c.k.naive)}`,
    `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr)} нь FDR-ийн дараа ач холбогдолтой (${c.nf(c.k.fdr_up)} өсөлт, ${c.nf(c.k.fdr_down)} бууралт); энгийн тест ${c.nf(c.k.naive)} нүдийг тэмдэглэх байсан`);
  const join = (...parts) => B(parts.map((p) => p.en).join(" · "), parts.map((p) => p.mn).join(" · "));
  // the detectable year; when it already lies inside the record, say so instead of quoting a past year
  function whenLine(c, s) {
    const d = s ? (s.detect || c.det(s)) : null;   // a selection carries its detectable year; an area mean is computed here
    if (!d) return B("—", "—");
    if (d.y <= c.st.y1) return B(`Already detectable: by ${d.y} (range ${d.lo}–${c.detectShort(d).split("–").pop()}`, `Аль хэдийн илэрсэн: ${d.y} он гэхэд (муж ${d.lo}–${c.detectShort(d).split("–").pop()}`);
    return B(c.detectShort(d), c.detectShort(d));
  }
  const NA = B("—", "—");

  // ---- MODIS cases (docs/MODIS_TRENDS.md): boxes in degrees [west, south, east, north] and evidence helpers
  const UB_CITY = [106.74, 47.84, 107.06, 47.98];            // the built-up capital, about 24 × 16 km
  const TAVAN_TOLGOI = [105.365, 43.54, 105.615, 43.72];     // 20 km around the pit centre 105.49°E 43.63°N (read off NASA HLS)
  const OYU_TOLGOI = [106.72, 42.92, 106.97, 43.10];         // 20 km around the mine point 106.843°E 43.008°N (GeoNames)
  // a box selection against the scene's first area mean
  function boxVsMean(c, name) {
    const s = c.sel, n = c.st.sel && c.st.sel.cells ? c.st.sel.cells.length : 0;
    if (!s) return NA;
    const ref = c.sc.region_means && c.sc.region_means[0] ? c.A.regionName(c.sc.region_means[0]) : "";
    return join(B(`${name.en} (${c.nf(n)} cells): ${meanLine(c, s, c.unit).en}: ${trendWord(c, s).en}`, `${name.mn} (${c.nf(n)} нүд): ${meanLine(c, s, c.unit).mn}: ${trendWord(c, s).mn}`),
      B(`${ref}: ${c.signed(c.rs.sen)} ${c.unit} per decade`, `${ref}: арван жилд ${c.signed(c.rs.sen)} ${c.unit}`));
  }
  // a selected cell: its trend, verdict and detectable year
  const cellLine = (c, name) => (c.sel ? B(`${name.en}: ${meanLine(c, c.sel, c.unit).en}: ${trendWord(c, c.sel).en}; ${whenLine(c, c.sel).en}`,
    `${name.mn}: ${meanLine(c, c.sel, c.unit).mn}: ${trendWord(c, c.sel).mn}; ${whenLine(c, c.sel).mn}`) : NA);
  const stepsLine = (c) => {
    const has = c.sc.steps && c.sc.steps.length;
    return B(`${c.nf(c.k.step_flagged || 0)} of ${c.nf(c.k.valid)} cells show a significant step at a documented transition${has ? "" : " (no transition inside these years)"}.`,
      `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.step_flagged || 0)} нь баримтжуулсан шилжилт дээр ач холбогдолтой алхамтай${has ? "" : " (эдгээр онуудад шилжилт алга)"}.`);
  };
  const pstarLine = (c) => (c.res.pstar > 0 ? B(`FDR threshold p* = ${c.fmt(c.res.pstar, 3)}`, `FDR босго p* = ${c.fmt(c.res.pstar, 3)}`) : B("no cell passes the FDR test", "FDR тестийг нэг ч нүд давахгүй"));
  // the compare side cell by cell, across grids: for each valid cell on screen, the compare cell that holds its centre
  function crossGrid(c) {
    const cmp = c.A.cmp;
    if (!cmp.on || !cmp.res || !cmp.entry || !c.res || !c.res.cells) return null;
    const g = c.sc.grid, h = cmp.entry.sc.grid, ca = c.res.cells, cb = cmp.res.cells, sa = c.res.status, sb = cmp.res.status;
    const valid = (s) => s >= 1 && s <= 5, sig = (s) => s === 1 || s === 2;
    let n = 0, agree = 0, both = 0, bothAgree = 0;
    for (let j = 0; j < g.ny; j++) {
      const jj = Math.round((g.lat[j] - h.lat[0]) / h.dlat);
      if (jj < 0 || jj >= h.ny) continue;
      for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (!valid(sa[k]) || ca.sen[k] === null || ca.sen[k] === undefined) continue;
        const ii = Math.round((g.lon[i] - h.lon[0]) / h.dlon);
        if (ii < 0 || ii >= h.nx) continue;
        const m = jj * h.nx + ii;
        if (!valid(sb[m]) || cb.sen[m] === null || cb.sen[m] === undefined) continue;
        const a = Math.sign(ca.sen[k]), b = Math.sign(cb.sen[m]);
        if (!a || !b) continue;
        n++; if (a === b) agree++;
        if (sig(sa[k]) && sig(sb[m])) { both++; if (a === b) bothAgree++; }
      }
    }
    return n ? { n, agree: agree / n, both, bothAgree: both ? bothAgree / both : 0, rs: cmp.res.regionStats ? cmp.res.regionStats[0] : null, y0: cmp.y0, y1: cmp.y1 } : null;
  }
  function agreeLine(c) {
    const x = crossGrid(c);
    if (!x) return NA;
    const ru = x.rs ? c.A.unitLabel(c.A.cmp.entry.sc.units) : "";
    return join(B(`${pct(x.agree)} of ${c.nf(x.n)} cells share the sign of the cell that holds them; ${x.both ? `${pct(x.bothAgree)} of the ${c.nf(x.both)} significant in both` : "none significant in both"}`,
        `${c.nf(x.n)} нүдний ${pct(x.agree)} нь агуулж буй нүдтэйгээ ижил тэмдэгтэй; ${x.both ? `хоёуланд нь ач холбогдолтой ${c.nf(x.both)} нүдний ${pct(x.bothAgree)}` : "хоёуланд нь ач холбогдолтой нүд алга"}`),
      x.rs ? B(`means: surface ${c.signed(c.rs.sen)} ${c.unit} vs air ${c.signed(x.rs.sen)} ${ru} per decade`, `дундаж: гадаргуу ${c.signed(c.rs.sen)} ${c.unit}, агаар ${c.signed(x.rs.sen)} ${ru} арван жилд`) : NA);
  }

  // ------------------------------------------------------------ the cases
  const CASES = [
    {
      id: "planet-warming", tag: "global",
      title: B("Is the planet warming, and where fastest?", "Дэлхий дулаарч байна уу, хамгийн хурдан хаана?"),
      question: B("45 years of MERRA-2 air temperature, every cell tested for a trend that survives the false discovery rate.",
        "MERRA-2-ийн 45 жилийн агаарын температур; нүд бүрийг хуурамч нээлтийн хувийг давах чигээр шалгасан."),
      steps: [
        { action: { scene: "global-t2m", view: "map", layer: "trend", zoom: "reset", sel: null },
          title: B("The whole planet", "Дэлхий бүхэлдээ"),
          text: B("Air temperature at 2 m from the MERRA-2 reanalysis, 1981–2025, reduced to a 2° grid. Red cells warm, blue cells cool. Full colour means the cell's trend survives the false discovery rate (FDR) test run across the whole map; faded cells do not.",
            "MERRA-2 дахин шинжилгээний 2 м-ийн агаарын температур, 1981–2025, 2°-ийн торонд багасгасан. Улаан нүд дулаарч, цэнхэр нүд хөрч байна. Тод өнгө нь тухайн нүдний чиг бүх газрын зурагт хийсэн хуурамч нээлтийн хувийн (FDR) тестийг давсныг заана; бүдэг нүд даваагүй."),
          evidence: (c) => join(cellsLine(c), B(`Globe, area-weighted: ${meanLine(c, c.rs, c.unit).en}`, `Дэлхий, талбайгаар жигнэсэн: ${meanLine(c, c.rs, c.unit).mn}`)) },
        { action: { layer: "verdict" },
          title: B("Not every colour is a verdict", "Өнгө бүр дүгнэлт биш"),
          text: B("The verdict layer sorts the cells: detected and confirmed by a second, parametric test; detected by one test only; not yet detectable with a record this short; excluded for missing months. “Not yet” is not “no change”.",
            "Дүгнэлтийн давхарга нүдийг ангилна: илэрсэн бөгөөд хоёр дахь, параметрт тест баталсан; зөвхөн нэг тест илрүүлсэн; ийм богино бүртгэлээр хараахан илрэхгүй; сар дутуу тул хассан. «Хараахан биш» гэдэг нь «өөрчлөлтгүй» гэсэн үг биш."),
          evidence: (c) => B(`${c.nf(c.k.robust)} cells confirmed by both tests · ${c.nf(c.k.not_yet)} not yet detectable · ${c.nf(c.k.gappy || 0)} excluded`,
            `${c.nf(c.k.robust)} нүдийг хоёр тест хоёулаа баталсан · ${c.nf(c.k.not_yet)} хараахан илрэхгүй · ${c.nf(c.k.gappy || 0)} хассан`) },
        { action: { layer: "trend", box: [-180, 66.5, 180, 90], zoom: { lon: 0, lat: 72, z: 2.2 } },
          title: B("The Arctic warms fastest", "Арктик хамгийн хурдан дулаарна"),
          text: B("A box over the Arctic Ocean (north of 66.5°) averages its cells, weighted by area, and runs the same tests on the mean series. Compare the box trend with the global mean of the first step: Arctic amplification shows in a reanalysis, not only in climate models.",
            "Арктикийн далай дээрх (66.5°-аас хойш) хайрцаг нүднүүдээ талбайгаар жигнэж дундажлаад, дундаж цуваанд ижил тестүүдийг ажиллуулна. Хайрцгийн чигийг эхний алхмын дэлхийн дундажтай харьцуул: Арктикийн эрчимжилт зөвхөн уур амьсгалын загварт биш, дахин шинжилгээнд ч харагдана."),
          evidence: (c) => {
            const s = c.sel, n = c.st.sel && c.st.sel.cells ? c.st.sel.cells.length : 0, ratio = s && c.rs && c.rs.sen ? c.fmt(s.sen / c.rs.sen, 2) : "?";
            return s ? B(`Arctic box (${c.nf(n)} cells): ${meanLine(c, s, c.unit).en}; ${ratio} × the global mean`,
              `Арктикийн хайрцаг (${c.nf(n)} нүд): ${meanLine(c, s, c.unit).mn}; дэлхийн дундажаас ${ratio} дахин их`) : NA;
          } },
        { action: { layer: "emerge", sel: null, zoom: "reset" },
          title: B("When does a trend become undeniable?", "Чиг хэзээ маргаангүй болох вэ?"),
          text: B("The “year detectable” layer gives, for each cell, the year by which a trend of the measured size is detected with 90 % probability if it continues (Weatherhead et al. 1998). Noisy regions need decades more data than calm ones.",
            "«Илрэх он» давхарга нүд бүрт хэмжсэн хэмжээтэй чиг үргэлжилбэл 90 %-ийн магадлалтайгаар илрэх оныг өгнө (Weatherhead нар, 1998). Шуугиантай бүс нутагт тайван бүсээс хэдэн арван жил илүү өгөгдөл хэрэгтэй."),
          evidence: (c) => B(`Global mean: ${c.detectSentence(c.det(c.rs))}`, `Дэлхийн дундаж: ${c.detectSentence(c.det(c.rs))}`) },
        { action: { layer: "trend", sel: null, zoom: "reset" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions of the challenge, answered from the numbers on screen.", "Сорилтын дөрвөн асуултад дэлгэц дээрх тоогоор хариулав."),
          verdict: (c) => ({
            what: B(`Air temperature at 2 m is ${trendWord(c, c.rs).en} over most of the planet.`, `2 м-ийн агаарын температур дэлхийн ихэнх хэсэгт ${trendWord(c, c.rs).mn}.`),
            where: B(`${c.nf(c.k.fdr_up)} cells warming and ${c.nf(c.k.fdr_down)} cooling after FDR, out of ${c.nf(c.k.valid)}; the Arctic fastest.`,
              `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_up)} нь дулаарч, ${c.nf(c.k.fdr_down)} нь хөрч байна (FDR-ийн дараа); Арктик хамгийн хурдан.`),
            howmuch: B(`Globe ${meanLine(c, c.rs, c.unit).en}; Northern Hemisphere ${c.signed(c.rsBy("nh").sen)}, Southern ${c.signed(c.rsBy("sh").sen)}.`,
              `Дэлхий ${meanLine(c, c.rs, c.unit).mn}; Хойд хагас бөмбөрцөг ${c.signed(c.rsBy("nh").sen)}, Өмнөд ${c.signed(c.rsBy("sh").sen)}.`),
            significant: B(`Yes: corrected p ${c.fmtP(c.rs.p_mk)} for the global mean; FDR threshold p* = ${c.fmt(c.res.pstar, 2)} across cells.`,
              `Тийм: дэлхийн дундажийн засварласан p ${c.fmtP(c.rs.p_mk)}; нүдүүдийн FDR босго p* = ${c.fmt(c.res.pstar, 2)}.`),
            when: whenLine(c, c.rs),
            caveats: [B("MERRA-2 is a reanalysis: a model constrained by observations, not a thermometer network. Documented changes in its sea-surface inputs (1982, 2005, 2006) are tested as steps in every cell.",
              "MERRA-2 бол дахин шинжилгээ: ажиглалтаар хязгаарласан загвар, термометрийн сүлжээ биш. Далайн гадаргын оролтын баримтжуулсан өөрчлөлтийг (1982, 2005, 2006) нүд бүрт алхам байдлаар шалгасан."),
              B("Cells are 2° here; the live analysis reads the native 0.5° × 0.625° grid for any box on Earth.", "Энд нүд 2°; шууд шинжилгээ дэлхийн аль ч хайрцагт 0.5° × 0.625°-ийн анхдагч торыг уншина.")],
          }) },
      ],
    },
    {
      id: "mongolia-warming", tag: "mongolia",
      title: B("Is Mongolia warming, and in which season?", "Монгол дулаарч байна уу, аль улиралд?"),
      question: B("The country mean, every cell, spring against winter, and the cell that holds Ulaanbaatar.",
        "Улсын дундаж, нүд бүр, хавар өвөл хоёр, Улаанбаатарыг агуулсан нүд."),
      steps: [
        { action: { scene: "mn-t2m", view: "map", layer: "trend", season: "all", years: "full", zoom: "reset", sel: null },
          title: B("The whole country, all months", "Улс бүхэлдээ, бүх сар"),
          text: B("MERRA-2 at about 50 km, 1981–2025, monthly values in every cell. Most of the country is red. A band through the centre is faded: there the trend is not yet separable from year-to-year noise, which is a different statement from “no warming”.",
            "MERRA-2, ойролцоогоор 50 км, 1981–2025, нүд бүрт сарын утга. Улсын ихэнх хэсэг улаан. Төв хэсгээр нэг зурвас бүдэг: тэнд чиг жил хоорондын шуугианаас хараахан ялгарахгүй байгаа нь «дулаараагүй» гэдгээс өөр мэдэгдэл."),
          evidence: (c) => join(B(`Mongolia (country mask): ${meanLine(c, c.rs, c.unit).en}`, `Монгол (улсын хилээр): ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { season: "mam", layer: "trend", sel: null },
          title: B("Spring", "Хавар"),
          text: B("Only March–May enters each year now; every test, count and map is recomputed in the browser. Spring is the dust and fire season, and its warming is stronger than the annual mean.",
            "Одоо жил бүрт зөвхөн 3–5-р сар орно; бүх тест, тоо, газрын зураг хөтөч дээр дахин тооцогдоно. Хавар бол тоос, түймрийн улирал бөгөөд түүний дулаарал жилийн дундажаас хүчтэй."),
          evidence: (c) => join(B(`Spring: ${meanLine(c, c.rs, c.unit).en}`, `Хавар: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { season: "djf", layer: "trend", sel: null },
          title: B("Winter", "Өвөл"),
          text: B("December–February: the same tests on the same cells give a different answer. Winters have not warmed detectably in this record; the dzud season is not where the signal is.",
            "12–2-р сар: ижил нүдэнд ижил тестүүд өөр хариулт өгнө. Энэ бүртгэлд өвөл илрэхүйц дулаараагүй; зудын улирал бол дохио байгаа газар биш."),
          evidence: (c) => join(B(`Winter: ${meanLine(c, c.rs, c.unit).en}`, `Өвөл: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { season: "all", layer: "trend", place: "Ulaanbaatar", zoom: { lon: 106.9, lat: 47.9, z: 2.5 } },
          title: B("Ulaanbaatar", "Улаанбаатар"),
          text: B("The cell that holds the capital. Click any cell for its own series, confidence interval, and the year its trend becomes detectable; shift-drag a box to average a region.",
            "Нийслэлийг агуулсан нүд. Аль ч нүд дээр дарвал түүний цуваа, итгэлийн завсар, чиг нь илрэх он гарна; бүс нутгийг дундажлахын тулд Shift дараад хайрцаг зурна."),
          evidence: (c) => (c.sel ? B(`Ulaanbaatar cell: ${meanLine(c, c.sel, c.unit).en}: ${trendWord(c, c.sel).en} on its own; detectable by ${c.detectShort(c.sel.detect)}`,
            `Улаанбаатарын нүд: ${meanLine(c, c.sel, c.unit).mn}: дангаараа ${trendWord(c, c.sel).mn}; илрэх он ${c.detectShort(c.sel.detect)}`) : NA) },
        { action: { season: "all", layer: "trend", sel: null, zoom: "reset" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions, answered for Mongolia.", "Дөрвөн асуултад Монголын хувьд хариулав."),
          verdict: (c) => ({
            what: B(`Air temperature over Mongolia is ${trendWord(c, c.rs).en}, driven by spring and the warm season rather than winter.`,
              `Монголын агаарын температур ${trendWord(c, c.rs).mn}; үүнийг өвөл биш хавар болон дулааны улирал хөтөлж байна.`),
            where: B(`${c.nf(c.k.fdr)} of ${c.nf(c.k.valid)} cells after FDR, across the whole country except a faded central band.`,
              `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr)} нь FDR-ийн дараа; төвийн бүдэг зурвасаас бусад улс даяар.`),
            howmuch: B(`Country mean ${meanLine(c, c.rs, c.unit).en}.`, `Улсын дундаж ${meanLine(c, c.rs, c.unit).mn}.`),
            significant: B(`Yes for the annual and spring means (corrected p ${c.fmtP(c.rs.p_mk)} annual); no for winter.`,
              `Жилийн болон хаврын дундажид тийм (жилийн засварласан p ${c.fmtP(c.rs.p_mk)}); өвөлд үгүй.`),
            when: whenLine(c, c.rs),
            caveats: [B("A reanalysis cell is ~50 km of terrain, not a station; Ulaanbaatar's urban heat island is not resolved.",
              "Дахин шинжилгээний нүд бол станц биш, ~50 км-ийн газар нутаг; Улаанбаатарын хотын дулааны арлыг ялгахгүй."),
              B("A season straddling New Year (Dec–Feb) starts one year later than the record.", "Шинэ жил дамнасан улирал (12–2-р сар) бүртгэлээс нэг жил хожуу эхэлнэ.")],
          }) },
      ],
    },
    {
      id: "antarctic-ice", tag: "trap",
      title: B("Is Antarctic sea ice growing? A model and a satellite disagree", "Антарктидын далайн мөс өсөж байна уу? Загвар ба хиймэл дагуул зөрж байна"),
      question: B("The cross-check that turned a significant trend into a data artifact, and found the date of the switch.",
        "Ач холбогдолтой чигийг өгөгдлийн хуурмаг болгож, шилжилтийн огноог олсон хөндлөн шалгалт."),
      steps: [
        { action: { scene: "global-seaice", view: "map", layer: "trend", sel: null, zoom: { lon: 0, lat: -68, z: 2.4 } },
          title: B("What MERRA-2 says", "MERRA-2 юу гэж байна"),
          text: B("Sea-ice fraction in MERRA-2, 1981–2025. Summed over the Southern Ocean the ice area rises; in the Arctic it falls. Both trends pass the corrected test.",
            "MERRA-2 дахь далайн мөсний хувь, 1981–2025. Өмнөд далай даяар нийлбэрлэхэд мөсний талбай өсөж, Арктикт буурна. Хоёр чиг хоёулаа засварласан тестийг давна."),
          evidence: (c) => B(`Antarctic area ${meanLine(c, c.rsBy("antarctic_area"), "million km²").en}; Arctic area ${c.signed(c.rsBy("arctic_area").sen)} (corrected p ${c.fmtP(c.rsBy("arctic_area").p_mk)})`,
            `Антарктидын талбай ${meanLine(c, c.rsBy("antarctic_area"), "сая км²").mn}; Арктикийн талбай ${c.signed(c.rsBy("arctic_area").sen)} (засварласан p ${c.fmtP(c.rsBy("arctic_area").p_mk)})`) },
        { action: { tab: "analysis" },
          title: B("Ask an independent record", "Хараат бус бүртгэлээс асуу"),
          text: B("The Analysis tab checks MERRA-2 against the NSIDC Sea Ice Index, the satellite record built for exactly this purpose. Subtracting NSIDC's monthly anomalies from MERRA-2's removes the weather and climate both share; what is left is the data.",
            "Шинжилгээний таб MERRA-2-ыг яг энэ зорилгоор бүтээсэн хиймэл дагуулын бүртгэл болох NSIDC-ийн далайн мөсний индекстэй шалгана. NSIDC-ийн сарын аномалийг MERRA-2-ынхоос хасахад хоёуланд нь нийтлэг цаг агаар, уур амьсгал арилж, өгөгдөл л үлдэнэ."),
          evidence: (c) => {
            const h = c.ref && c.ref.hemispheres.find((x) => x.key === "S"), st = h && c.stepOf(h.difference, "2005-01");
            return h ? B(`NSIDC Antarctic area ${c.signed(h.nsidc_area.sen)} million km² per decade (p ${c.fmtP(h.nsidc_area.p_mk)}): no detectable trend. MERRA-2 minus NSIDC jumps ${c.signed(st ? st.step : NaN)} million km² in January 2005 (p ${c.fmtP(st ? st.p_step : NaN)}).`,
              `NSIDC Антарктидын талбай арван жилд ${c.signed(h.nsidc_area.sen)} сая км² (p ${c.fmtP(h.nsidc_area.p_mk)}): илрэх чиг алга. MERRA-2-оос NSIDC-ийг хассан зөрүү 2005 оны 1-р сард ${c.signed(st ? st.step : NaN)} сая км²-ээр үсэрнэ (p ${c.fmtP(st ? st.p_step : NaN)}).`) : NA;
          } },
        { action: { tab: "map", layer: "steps", zoom: { lon: 0, lat: -68, z: 2.4 } },
          title: B("The step shows on the map", "Алхам газрын зурагт харагдана"),
          text: B("The steps layer tests every cell for a jump at documented data-source changes. January 2005 is when the sea-ice input inside the Reynolds SST analysis that MERRA-2 uses switched from NASA GSFC to NCEP. The jump was found in the data first and matched to the documentation afterwards.",
            "Алхмын давхарга нүд бүрийг өгөгдлийн эх сурвалжийн баримтжуулсан өөрчлөлтийн үед үсрэлт байгаа эсэхээр шалгана. 2005 оны 1-р сар бол MERRA-2-ын ашигладаг Reynolds SST шинжилгээн дэх далайн мөсний оролт NASA GSFC-ээс NCEP рүү шилжсэн үе. Үсрэлтийг эхлээд өгөгдлөөс олж, дараа нь баримт бичигтэй тулгасан."),
          evidence: (c) => B(`${c.nf(c.k.step_flagged)} of ${c.nf(c.k.valid)} cells show a significant step at a documented transition (${c.sc.steps.map((s) => s.label.slice(0, 7)).join(", ")}).`,
            `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.step_flagged)} нь баримтжуулсан шилжилтийн үед ач холбогдолтой алхамтай (${c.sc.steps.map((s) => s.label.slice(0, 7)).join(", ")}).`) },
        { action: { tab: "map", layer: "trend", zoom: "reset" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("Which record to trust, and why.", "Аль бүртгэлд итгэх вэ, яагаад."),
          verdict: (c) => {
            const h = c.ref && c.ref.hemispheres.find((x) => x.key === "S"), st = h && c.stepOf(h.difference, "2005-01");
            const an = c.rsBy("antarctic_area"), ar = c.rsBy("arctic_area");
            return {
              what: B("MERRA-2's Antarctic sea-ice gain is a data artifact; the Arctic decline is real in both records.",
                "MERRA-2 дахь Антарктидын далайн мөсний өсөлт нь өгөгдлийн хуурмаг; Арктикийн бууралт хоёр бүртгэлд хоёуланд нь бодит."),
              where: B("Southern Ocean (artifact); Arctic (agreement).", "Өмнөд далай (хуурмаг); Арктик (тохирол)."),
              howmuch: B(`Antarctic: MERRA-2 ${c.signed(an.sen)} vs NSIDC ${h ? c.signed(h.nsidc_area.sen) : "?"} million km² per decade. Arctic: MERRA-2 ${c.signed(ar.sen)}.`,
                `Антарктид: MERRA-2 ${c.signed(an.sen)}, NSIDC ${h ? c.signed(h.nsidc_area.sen) : "?"} сая км² арван жилд. Арктик: MERRA-2 ${c.signed(ar.sen)}.`),
              significant: B(`MERRA-2 Antarctic p ${c.fmtP(an.p_mk)}; NSIDC p ${h ? c.fmtP(h.nsidc_area.p_mk) : "?"} (no trend); the January 2005 step in the difference p ${c.fmtP(st ? st.p_step : NaN)}.`,
                `MERRA-2 Антарктид p ${c.fmtP(an.p_mk)}; NSIDC p ${h ? c.fmtP(h.nsidc_area.p_mk) : "?"} (чиг алга); зөрүүний 2005 оны 1-р сарын алхам p ${c.fmtP(st ? st.p_step : NaN)}.`),
              when: B("Not applicable: the question was which record to believe.", "Хамаарахгүй: асуулт нь аль бүртгэлд итгэх тухай байсан."),
              caveats: [B("The 1982 (AMIP II → Reynolds) and April 2006 (Reynolds → OSTIA) switches are tested too.", "1982 (AMIP II → Reynolds) болон 2006 оны 4-р сарын (Reynolds → OSTIA) шилжилтийг мөн шалгасан."),
                B("NSIDC itself changed input from SSMIS to AMSR2 on 1 January 2025; tested in its own series, not significant.", "NSIDC өөрөө 2025 оны 1-р сарын 1-нд оролтоо SSMIS-ээс AMSR2 болгосон; өөрийн цувааг нь шалгахад ач холбогдолгүй.")],
            };
          } },
      ],
    },
    {
      id: "ozone-hole", tag: "trap",
      title: B("Where did the ozone hole go?", "Озоны цоорхой хаашаа алга болов?"),
      question: B("Censored data would create a trend that is not there; the tool refuses to compute it.",
        "Цензурдсан өгөгдөл байхгүй чигийг бий болгох байсан; хэрэгсэл түүнийг тооцохоос татгалзана."),
      steps: [
        { action: { scene: "global-ozone", view: "map", layer: "trend", sel: null, zoom: { lon: 0, lat: -68, z: 2.4 } },
          title: B("Total column ozone", "Озоны нийт багана"),
          text: B("MERRA-2 total ozone, 1981–2025. South of 60°S many cells carry no colour at all. They are not “no trend”: they are excluded, with a reason.",
            "MERRA-2 озоны нийт багана, 1981–2025. 60°S-ээс урагш олон нүд огт өнгөгүй. Тэд «чиг алга» биш: шалтгаантайгаар хассан."),
          evidence: (c) => B(`${c.nf(c.k.gappy)} cells excluded for missing months; ${c.nf(c.k.fdr)} of ${c.nf(c.k.valid)} tested cells significant after FDR.`,
            `${c.nf(c.k.gappy)} нүдийг сар дутуу тул хассан; шалгасан ${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr)} нь FDR-ийн дараа ач холбогдолтой.`) },
        { action: { layer: "verdict" },
          title: B("Why they are excluded", "Яагаад хассан бэ"),
          text: B("NASA POWER marks total ozone below 200 DU as invalid. The Antarctic ozone hole lies below 200 DU, so its deepest months vanish from the record. A trend on what remains would be censored upward. The tool detects partially missing cells and will not compute them.",
            "NASA POWER 200 DU-ээс бага нийт озоныг хүчингүй гэж тэмдэглэдэг. Антарктидын озоны цоорхой яг 200 DU-ээс доор байдаг тул хамгийн гүн сарууд нь бүртгэлээс алга болно. Үлдсэн дээр тооцсон чиг дээшээ цензурдсан байх байсан. Хэрэгсэл хэсэгчлэн дутуу нүдийг илрүүлж, тооцохгүй."),
          evidence: (c) => B(`Globe mean: ${meanLine(c, c.rs, c.unit).en}. The October 2004 SBUV → OMI/MLS input change is tested as a step: ${c.nf(c.sc.steps[0] ? c.sc.steps[0].flagged : 0)} cells flagged.`,
            `Дэлхийн дундаж: ${meanLine(c, c.rs, c.unit).mn}. 2004 оны 10-р сарын SBUV → OMI/MLS оролтын өөрчлөлтийг алхам байдлаар шалгасан: ${c.nf(c.sc.steps[0] ? c.sc.steps[0].flagged : 0)} нүд тэмдэглэгдсэн.`) },
        { action: { layer: "trend", zoom: "reset" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("What this product can and cannot say about ozone.", "Энэ бүтээгдэхүүн озоны талаар юу хэлж чадах, чадахгүй вэ."),
          verdict: (c) => ({
            what: B(`Total column ozone, global mean: ${trendWord(c, c.rs).en} in 1981–2025. The Antarctic hole is censored out of this product.`,
              `Озоны нийт баганын дэлхийн дундаж: 1981–2025 онд ${trendWord(c, c.rs).mn}. Антарктидын цоорхой энэ бүтээгдэхүүнээс цензурдагдсан.`),
            where: B(`${c.nf(c.k.gappy)} cells, mostly south of 60°S, excluded.`, `${c.nf(c.k.gappy)} нүд, ихэнх нь 60°S-ээс урагш, хассан.`),
            howmuch: B(`Globe ${meanLine(c, c.rs, c.unit).en}.`, `Дэлхий ${meanLine(c, c.rs, c.unit).mn}.`),
            significant: B(`Corrected p ${c.fmtP(c.rs.p_mk)}: no. Noise memory φ = ${c.fmt(c.rs.phi, 2)} makes the corrected test far stricter than the naive p ${c.fmtP(c.rs.p_naive)}.`,
              `Засварласан p ${c.fmtP(c.rs.p_mk)}: үгүй. Шуугианы санах ой φ = ${c.fmt(c.rs.phi, 2)} тул засварласан тест энгийн p ${c.fmtP(c.rs.p_naive)}-ээс хамаагүй хатуу.`),
            when: whenLine(c, c.rs),
            caveats: [B("The ozone input switched from SBUV to Aura OMI + MLS in October 2004 (tested as a step); the MLS v2.2 → v4.2 change in 2015 is unverified and not tested.",
              "Озоны оролт 2004 оны 10-р сард SBUV-ээс Aura OMI + MLS рүү шилжсэн (алхам байдлаар шалгасан); 2015 оны MLS v2.2 → v4.2 өөрчлөлт батлагдаагүй тул шалгаагүй."),
              B("For ozone-hole trends use a product that keeps values below 200 DU, such as NASA Ozone Watch.", "Озоны цоорхойн чигийг судлахдаа 200 DU-ээс бага утгыг хадгалдаг бүтээгдэхүүн, тухайлбал NASA Ozone Watch-ийг ашиглана.")],
          }) },
      ],
    },
    {
      id: "gobi-dust", tag: "hazard",
      title: B("Is the Gobi getting dustier?", "Говь тоостой болж байна уу?"),
      question: B("Dust-prone days, a boundary in the data, spring risk zones, the mines, and a satellite check.",
        "Тоосжих нөхцөлтэй өдрүүд, өгөгдөл дэх хил, хаврын эрсдэлийн бүс, уурхайнууд, хиймэл дагуулын шалгалт."),
      steps: [
        { action: { scene: "mn-dustdays", view: "map", layer: "trend", season: "all", years: "full", zoom: "reset", sel: null },
          title: B("Dust-prone days", "Тоосжих нөхцөлтэй өдрүүд"),
          text: B("Days per month that are snow-free, dry and windy (10 m wind ≥ 8 m/s) in daily MERRA-2, counted in every cell. Blue means fewer such days per decade.",
            "MERRA-2-ийн өдрийн өгөгдлөөр цасгүй, хуурай, салхитай (10 м-ийн салхи ≥ 8 м/с) өдрүүдийг нүд бүрт сар бүрээр тоолсон. Цэнхэр нь арван жилд ийм өдөр цөөрснийг заана."),
          evidence: (c) => join(B(`Mongolia: ${meanLine(c, c.rs, c.unit).en}`, `Монгол: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { layer: "steps" },
          title: B("A boundary in the data", "Өгөгдөл дэх хил"),
          text: B("MERRA-2 was produced in streams, and each new stream begins with a land spin-up year (1992, 2001, 2011). The steps layer finds a jump at 1992 in many cells, so the decline before 1992 cannot be read as climate.",
            "MERRA-2-ыг урсгалаар үйлдвэрлэсэн бөгөөд шинэ урсгал бүр газрын эргэлтэд орох жилээр эхэлдэг (1992, 2001, 2011). Алхмын давхарга олон нүдэнд 1992 онд үсрэлт олдог тул 1992 оноос өмнөх бууралтыг уур амьсгал гэж уншиж болохгүй."),
          evidence: (c) => B(`${c.nf(c.k.step_flagged)} of ${c.nf(c.k.valid)} cells show a significant step at a stream boundary.`,
            `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.step_flagged)} нь урсгалын хил дээр ач холбогдолтой алхамтай.`) },
        { action: { years: [1992, 2025], layer: "trend" },
          title: B("After 1992 only", "Зөвхөн 1992 оноос хойш"),
          text: B("Restricting the window to 1992–2025 removes the boundary. Every test, the FDR threshold and every count are recomputed in the browser for the shorter record.",
            "Цонхыг 1992–2025 болгож хязгаарлахад хил арилна. Богиносгосон бүртгэлд бүх тест, FDR-ийн босго, бүх тоо хөтөч дээр дахин тооцогдоно."),
          evidence: (c) => join(B(`1992–2025: ${meanLine(c, c.rs, c.unit).en}`, `1992–2025: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { years: "full", season: "mam", layer: "zone", zoom: "reset" },
          title: B("Risk zones in spring", "Хаврын эрсдэлийн бүс"),
          text: B("In March–May the risk-zone layer marks cells where the index is high (top third of this map) and, separately, where it is rising (an upward trend after FDR). Count them: a hazard that is high but not rising asks for a different response than one that is rising. The thirds are relative to this map, not an absolute standard.",
            "3–5-р сард эрсдэлийн бүсийн давхарга индекс нь өндөр (энэ зургийн дээд гуравны нэг) нүдийг, мөн тусад нь өсөж буй (FDR-ийн дараа өсөх чигтэй) нүдийг тэмдэглэнэ. Тоолж үз: өндөр боловч өсөхгүй аюул нь өсөж буй аюулаас өөр хариу арга хэмжээ шаардана. Гуравны нэгүүд нь энэ зурагт харьцангуй бөгөөд абсолют стандарт биш."),
          evidence: (c) => (c.zone ? B(`${c.nf(c.zone.counts[4])} cells high and rising · ${c.nf(c.zone.counts[3])} high · ${c.nf(c.zone.counts[2])} rising`,
            `${c.nf(c.zone.counts[4])} нүд өндөр бөгөөд өсөж буй · ${c.nf(c.zone.counts[3])} өндөр · ${c.nf(c.zone.counts[2])} өсөж буй`) : NA) },
        { action: { tab: "analysis", season: "mam" },
          title: B("Downwind of the mines, and a satellite check", "Уурхайн салхины доод тал ба хиймэл дагуулын шалгалт"),
          text: B("The Analysis tab shows where the wind carried dust on dust-prone days at Tavan Tolgoi, Oyu Tolgoi and Tsagaan Suvarga, and how often each nearby soum centre lay downwind. Against Sentinel-5P's UV aerosol index (2018–2025) dust-prone days read higher than calm days in 96 % of cases, but only one in six shows a clear plume: the index means “dust likely”, not “dust seen”.",
            "Шинжилгээний таб Таван толгой, Оюу толгой, Цагаан суваргад тоосжих өдрүүдэд салхи тоосыг хаашаа зөөснийг, ойролцоох сумын төв бүр хэр олон удаа салхины доод талд байсныг харуулна. Sentinel-5P-ийн хэт ягаан туяаны аэрозолийн индекстэй (2018–2025) тулгахад тоосжих өдрүүд тайван өдрөөс 96 % тохиолдолд өндөр уншигддаг ч зургаагийн нэгд нь л тод бөөгнөрөл харагдана: индекс «тоос магадлалтай» гэсэн утгатай, «тоос харагдсан» биш."),
          evidence: (c) => B(`Spring, Mongolia: ${meanLine(c, c.rs, c.unit).en}.`, `Хавар, Монгол: ${meanLine(c, c.rs, c.unit).mn}.`) },
        { action: { tab: "map", season: "all", years: "full", layer: "trend", zoom: "reset" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("What the record supports, and what it does not.", "Бүртгэл юуг дэмжиж, юуг дэмжихгүй вэ."),
          verdict: (c) => ({
            what: B(`Dust-prone days over Mongolia: ${trendWord(c, c.rs).en} over the full record, but the change before 1992 sits on a production-stream boundary and is reported as unconfirmed.`,
              `Монгол дахь тоосжих нөхцөлтэй өдрүүд: бүх хугацаанд ${trendWord(c, c.rs).mn}, гэвч 1992 оноос өмнөх өөрчлөлт үйлдвэрлэлийн урсгалын хил дээр байгаа тул батлагдаагүй гэж тайлагнана.`),
            where: B(`${c.nf(c.k.fdr_down)} cells fewer, ${c.nf(c.k.fdr_up)} more; ${c.nf(c.k.step_flagged)} cells carry a step at a boundary.`,
              `${c.nf(c.k.fdr_down)} нүдэнд цөөрч, ${c.nf(c.k.fdr_up)} нүдэнд олширч байна; ${c.nf(c.k.step_flagged)} нүд хил дээр алхамтай.`),
            howmuch: B(`Full record ${meanLine(c, c.rs, c.unit).en}; see step 3 for 1992 onward.`, `Бүх хугацаанд ${meanLine(c, c.rs, c.unit).mn}; 1992 оноос хойшхийг 3-р алхамд үз.`),
            significant: B(`Full record corrected p ${c.fmtP(c.rs.p_mk)}, but the step test flags the boundary; the shorter window is the honest estimate.`,
              `Бүх хугацааны засварласан p ${c.fmtP(c.rs.p_mk)}, гэвч алхмын тест хилийг тэмдэглэдэг; богино цонх нь шударга тооцоо.`),
            when: whenLine(c, c.rs),
            caveats: [B("The index is a meteorological proxy; Sentinel-5P confirms “dust likely”, not a concentration. MERRA-2 cells are ~50 km, so a mine's own footprint is not resolved.",
              "Индекс бол цаг уурын орлуулагч; Sentinel-5P «тоос магадлалтай» гэдгийг л баталдаг, агууламжийг биш. MERRA-2-ийн нүд ~50 км тул уурхайн өөрийн ул мөрийг ялгахгүй."),
              B("Surface dust and dust optical depth from MERRA-2 aerosols (GES DISC) are separate datasets in the layer manager.", "MERRA-2 аэрозолийн (GES DISC) гадаргын тоос ба тоосны оптик зузаан нь давхаргын самбарт тусдаа өгөгдлийн багц.")],
          }) },
      ],
    },
    {
      id: "ub-rain", tag: "hazard",
      title: B("Is Ulaanbaatar's heaviest rain getting heavier?", "Улаанбаатарын хамгийн их бороо нэмэгдэж байна уу?"),
      question: B("The wettest day of each month at the capital's cell: 45 years, then the satellite era, then satellites checked against the model.",
        "Нийслэлийн нүдэн дэх сар бүрийн хамгийн их борооны өдөр: 45 жил, дараа нь хиймэл дагуулын үе, дараа нь хиймэл дагуулыг загвартай тулгасан нь."),
      steps: [
        { action: { scene: "mn-rx1day", view: "map", layer: "trend", season: "all", years: "full", place: "Ulaanbaatar", zoom: { lon: 106.9, lat: 47.9, z: 2.5 } },
          title: B("The wettest day of the month", "Сарын хамгийн их борооны өдөр"),
          text: B("Rx1day: the largest daily total in each month, from daily MERRA-2. The cell holding Ulaanbaatar is selected; its series, confidence interval and tests are in the details pane.",
            "Rx1day: сар бүрийн хамгийн их өдрийн нийлбэр, MERRA-2-ийн өдрийн өгөгдлөөс. Улаанбаатарыг агуулсан нүд сонгогдсон; түүний цуваа, итгэлийн завсар, тестүүд дэлгэрэнгүй самбарт байна."),
          evidence: (c) => (c.sel ? B(`Ulaanbaatar cell, 1981–2025: ${meanLine(c, c.sel, c.unit).en}: ${trendWord(c, c.sel).en}`, `Улаанбаатарын нүд, 1981–2025: ${meanLine(c, c.sel, c.unit).mn}: ${trendWord(c, c.sel).mn}`) : NA) },
        { action: { years: [2001, 2025], season: "all", place: "Ulaanbaatar" },
          title: B("The satellite era, 2001 onward", "Хиймэл дагуулын үе, 2001 оноос"),
          text: B("The same cell over the years that GPM IMERG also covers. A shorter record gives a steeper estimate with a wider interval; compare its p-value with the full record's. Country-wide, the wettest day rises in many more cells over these years.",
            "Ижил нүд, GPM IMERG-ийн мөн хамардаг онуудад. Богино бүртгэл илүү эгц тооцоо, өргөн завсар өгнө; түүний p утгыг бүх хугацааныхтай харьцуул. Улс даяар эдгээр онуудад хамгийн их борооны өдөр хамаагүй олон нүдэнд өсдөг."),
          evidence: (c) => (c.sel ? join(B(`Ulaanbaatar cell, 2001–2025: ${meanLine(c, c.sel, c.unit).en}: ${trendWord(c, c.sel).en}`, `Улаанбаатарын нүд, 2001–2025: ${meanLine(c, c.sel, c.unit).mn}: ${trendWord(c, c.sel).mn}`), cellsLine(c)) : NA) },
        { action: { scene: "mn-precip-imerg", season: "all", compare: true, zoom: "reset", sel: null },
          title: B("Satellites against the model", "Хиймэл дагуул загварын эсрэг"),
          text: B("Split view: GPM IMERG (satellites) on the right and MERRA-2 (model) on the left, the same grid, 2001–2025. Where both records agree in sign, a precipitation trend is harder to dismiss as a model artifact. For the wettest day at the capital's cell the same check (docs/hazard_check.json) gives IMERG +0.39 mm per decade (p 0.005) against MERRA-2's +0.39 (p 0.10), and IMERG's wettest 0.1° pixel +0.95 (p 0.006): satellites at 10 km see the rise that the 50 km model only hints at.",
            "Хуваасан харагдац: баруун талд GPM IMERG (хиймэл дагуул), зүүн талд MERRA-2 (загвар), ижил тор, 2001–2025. Хоёр бүртгэл тэмдгээрээ тохирох газарт хур тунадасны чигийг загварын хуурмаг гэж үгүйсгэхэд хэцүү. Нийслэлийн нүдний хамгийн их борооны өдрийн хувьд ижил шалгалт (docs/hazard_check.json) IMERG-д арван жилд +0.39 мм (p 0.005), MERRA-2-т +0.39 (p 0.10), IMERG-ийн хамгийн их борооны 0.1°-ийн пикселд +0.95 (p 0.006) өгдөг: 10 км-ийн хиймэл дагуул 50 км-ийн загварын зөвхөн сэжүүрлэдэг өсөлтийг хардаг."),
          evidence: (c) => {
            const p = c.comparison("mn-precip-imerg");
            return p ? B(`${pct(p.sign_agreement_all)} of cells share a sign; monthly anomalies correlate at ${c.fmt(p.region_anomaly_correlation, 2)}; Mongolia mean MERRA-2 ${c.signed(p.region_trend_a.sen)} vs IMERG ${c.signed(p.region_trend_b.sen)} mm/day per decade.`,
              `Нүдний ${pct(p.sign_agreement_all)} нь ижил тэмдэгтэй; сарын аномалийн корреляци ${c.fmt(p.region_anomaly_correlation, 2)}; Монголын дундаж MERRA-2 ${c.signed(p.region_trend_a.sen)}, IMERG ${c.signed(p.region_trend_b.sen)} мм/өдөр арван жилд.`) : NA;
          } },
        { action: { scene: "mn-rx1day", compare: false, season: "all", years: [2001, 2025], layer: "trend", place: "Ulaanbaatar", zoom: { lon: 106.9, lat: 47.9, z: 2.5 } }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions for the capital's heaviest rain, on the satellite-era window.", "Нийслэлийн хамгийн их борооны дөрвөн асуулт, хиймэл дагуулын үеийн цонхонд."),
          verdict: (c) => ({
            what: B(`The wettest day of the month at the capital's MERRA-2 cell, 2001–2025: ${c.sel ? trendWord(c, c.sel).en : "?"}; GPM IMERG over the same cell shows a rise (p 0.005), so the satellites see what the model only hints at.`,
              `Нийслэлийн MERRA-2 нүдэн дэх сарын хамгийн их борооны өдөр, 2001–2025: ${c.sel ? trendWord(c, c.sel).mn : "?"}; ижил нүд дээр GPM IMERG өсөлт үзүүлдэг (p 0.005) тул хиймэл дагуул загварын зөвхөн сэжүүрлэдгийг хардаг.`),
            where: B(`The capital's cell; country-wide ${c.nf(c.k.fdr_up)} cells rise and ${c.nf(c.k.fdr_down)} fall after FDR over these years.`, `Нийслэлийн нүд; эдгээр онуудад улс даяар FDR-ийн дараа ${c.nf(c.k.fdr_up)} нүдэнд өсөж, ${c.nf(c.k.fdr_down)} нүдэнд буурна.`),
            howmuch: c.sel ? B(`Ulaanbaatar, MERRA-2 ${meanLine(c, c.sel, c.unit).en}; IMERG +0.39 (CI 0.09…0.77); IMERG's wettest pixel +0.95.`, `Улаанбаатар, MERRA-2 ${meanLine(c, c.sel, c.unit).mn}; IMERG +0.39 (завсар 0.09…0.77); IMERG-ийн хамгийн их пиксел +0.95.`) : NA,
            significant: c.sel ? B(`MERRA-2 corrected p ${c.fmtP(c.sel.p_mk)} (no); IMERG p 0.005 (yes); IMERG pixel p 0.006 (yes).`, `MERRA-2 засварласан p ${c.fmtP(c.sel.p_mk)} (үгүй); IMERG p 0.005 (тийм); IMERG пиксел p 0.006 (тийм).`) : NA,
            when: c.sel ? whenLine(c, c.sel) : NA,
            caveats: [B("Over 1981–2025 the capital's MERRA-2 cell shows no detectable trend (step 1); the rise is a satellite-era finding. Daily MERRA-2 precipitation over Mongolia is partly model-based.",
              "1981–2025 онд нийслэлийн MERRA-2 нүд илрэх чиггүй (1-р алхам); өсөлт нь хиймэл дагуулын үеийн олдвор. Монгол дахь MERRA-2-ийн өдрийн хур тунадас хэсэгчлэн загварт суурилдаг."),
              B("A cell's wettest day (15 mm in June–August) is not a flood threshold; the wettest 0.1° pixel averages 25.7 mm. IMERG changed calibration from TRMM to GPM in June 2014.",
                "Нүдний хамгийн их борооны өдөр (6–8-р сард 15 мм) бол үерийн босго биш; хамгийн их борооны 0.1°-ийн пикселийн дундаж 25.7 мм. IMERG 2014 оны 6-р сард тохируулгаа TRMM-ээс GPM болгосон.")],
          }) },
      ],
    },
    {
      id: "dzud", tag: "hazard",
      title: B("Are the ingredients of dzud changing?", "Зудын найрлага өөрчлөгдөж байна уу?"),
      question: B("A dry summer, deep snow, a cold winter: each ingredient tested on its own over 45 years, with no dzud index invented.",
        "Хуурай зун, зузаан цас, хүйтэн өвөл: найрлага бүрийг 45 жилийн хугацаанд тус тусад нь шалгасан; зудын индекс зохиогоогүй."),
      steps: [
        { action: { scene: "mn-soil", view: "map", layer: "trend", season: "jja", years: "full", zoom: "reset", sel: null },
          title: B("The summer before: soil moisture", "Өмнөх зун: хөрсний чийг"),
          text: B("Dzud begins in summer. Poor pasture after a dry June–August leaves animals thin before the cold. Root-zone soil wetness (a 0–1 index from MERRA-2) in summer, 1981–2025, every cell tested.",
            "Зуд зунаас эхэлдэг. Хуурай 6–8-р сарын дараах муу бэлчээр малыг хүйтнээс өмнө турааж орхино. Зуны үндэсний давхаргын хөрсний чийг (MERRA-2-ийн 0–1 индекс), 1981–2025, нүд бүрийг шалгасан."),
          evidence: (c) => join(B(`Summer, Mongolia: ${meanLine(c, c.rs, c.unit).en}: ${trendWord(c, c.rs).en}`, `Зун, Монгол: ${meanLine(c, c.rs, c.unit).mn}: ${trendWord(c, c.rs).mn}`), cellsLine(c)) },
        { action: { scene: "mn-snowdays", season: "ndjfm", years: "full", layer: "trend", zoom: "reset", sel: null },
          title: B("Snow-covered days, November–March", "Цасан бүрхүүлтэй өдрүүд, 11–3-р сар"),
          text: B("Days per month with the ground under snow (MERRA-2 snow cover, calibrated against MODIS). Snow that stays locks the pasture away; more snow days is the white-dzud ingredient.",
            "Газар цасан дор байх сарын өдрийн тоо (MODIS-той тохируулсан MERRA-2-ийн цасан бүрхүүл). Тогтсон цас бэлчээрийг хаадаг; цасан өдөр олширвол цагаан зудын найрлага."),
          evidence: (c) => join(B(`Nov–Mar, Mongolia: ${meanLine(c, c.rs, c.unit).en}: ${trendWord(c, c.rs).en}`, `11–3-р сар, Монгол: ${meanLine(c, c.rs, c.unit).mn}: ${trendWord(c, c.rs).mn}`), cellsLine(c)) },
        { action: { scene: "mn-snow", season: "ndjfm", years: "full", layer: "trend", zoom: "reset", sel: null },
          title: B("Snow depth", "Цасны зузаан"),
          text: B("The same months, snow depth instead of cover. Depth is what buries the grass; cover is what reflects the sun and keeps the ground cold.",
            "Ижил сарууд, бүрхүүлийн оронд цасны зузаан. Өвсийг булдаг нь зузаан; нарыг ойлгож газрыг хүйтэн байлгадаг нь бүрхүүл."),
          evidence: (c) => join(B(`Nov–Mar, Mongolia: ${meanLine(c, c.rs, c.unit).en}: ${trendWord(c, c.rs).en}`, `11–3-р сар, Монгол: ${meanLine(c, c.rs, c.unit).mn}: ${trendWord(c, c.rs).mn}`), cellsLine(c)) },
        { action: { scene: "mn-t2m", season: "djf", years: "full", layer: "trend", zoom: "reset", sel: null },
          title: B("Winter cold", "Өвлийн хүйтэн"),
          text: B("December–February air temperature. The warming of the annual mean is not a winter story: winters have not warmed detectably, so the cold ingredient of dzud has not weakened in this record.",
            "12–2-р сарын агаарын температур. Жилийн дундажийн дулаарал өвлийн түүх биш: өвөл илрэхүйц дулаараагүй тул зудын хүйтний найрлага энэ бүртгэлд сулраагүй."),
          evidence: (c) => join(B(`Winter, Mongolia: ${meanLine(c, c.rs, c.unit).en}: ${trendWord(c, c.rs).en}`, `Өвөл, Монгол: ${meanLine(c, c.rs, c.unit).mn}: ${trendWord(c, c.rs).mn}`), cellsLine(c)) },
        { action: { scene: "mn-snowdays", season: "ndjfm", years: "full", layer: "zone", zoom: "reset", sel: null },
          title: B("Where snow days are high, and where they are rising", "Цасан өдөр хаана олон, хаана олширч байна"),
          text: B("The risk-zone layer marks cells in the top third of this map for snow days and, separately, cells where they are rising after FDR. Count the cells that are both.",
            "Эрсдэлийн бүсийн давхарга цасан өдрөөр энэ зургийн дээд гуравны нэгд орох нүдийг, мөн тусад нь FDR-ийн дараа олширч буй нүдийг тэмдэглэнэ. Хоёулаа байгаа нүдийг тоол."),
          evidence: (c) => (c.zone ? B(`${c.nf(c.zone.counts[4])} cells high and rising · ${c.nf(c.zone.counts[3])} high · ${c.nf(c.zone.counts[2])} rising`,
            `${c.nf(c.zone.counts[4])} нүд өндөр бөгөөд өсөж буй · ${c.nf(c.zone.counts[3])} өндөр · ${c.nf(c.zone.counts[2])} өсөж буй`) : NA) },
        { action: { scene: "mn-snowdays", season: "ndjfm", years: "full", layer: "trend", zoom: "reset", sel: null }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("Ingredient by ingredient; the compound event itself is not in these data.", "Найрлага тус бүрээр; нийлмэл үзэгдэл өөрөө энэ өгөгдөлд байхгүй."),
          verdict: (c) => ({
            what: B(`Snow-covered days in November–March over Mongolia: ${trendWord(c, c.rs).en}. See steps 1, 3 and 4 for summer soil, snow depth and winter cold.`,
              `Монголын 11–3-р сарын цасан бүрхүүлтэй өдөр: ${trendWord(c, c.rs).mn}. Зуны хөрс, цасны зузаан, өвлийн хүйтнийг 1, 3, 4-р алхамд үз.`),
            where: B(`${c.nf(c.k.fdr_up)} cells with more snow days, ${c.nf(c.k.fdr_down)} with fewer, of ${c.nf(c.k.valid)} after FDR.`, `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_up)} нь цасан өдөр олширч, ${c.nf(c.k.fdr_down)} нь цөөрч байна (FDR-ийн дараа).`),
            howmuch: B(`Country mean ${meanLine(c, c.rs, c.unit).en}.`, `Улсын дундаж ${meanLine(c, c.rs, c.unit).mn}.`),
            significant: B(`Corrected p ${c.fmtP(c.rs.p_mk)} for snow days; the other ingredients carry their own p in their steps.`, `Цасан өдрийн засварласан p ${c.fmtP(c.rs.p_mk)}; бусад найрлага өөрсдийн алхамд өөрийн p-тэй.`),
            when: whenLine(c, c.rs),
            caveats: [B("Dzud is a compound event: summer drought, snow, cold and herd size together. No index of it is computed here, and livestock numbers are not in these data.",
              "Зуд бол нийлмэл үзэгдэл: зуны ган, цас, хүйтэн, малын тоо хамтдаа. Энд түүний индексийг тооцоогүй бөгөөд малын тоо энэ өгөгдөлд байхгүй."),
              B("MERRA-2 snow cover was calibrated against MODIS over Mongolia (docs/METHODS.md); a 50 km cell cannot show one valley's ice crust (black dzud).",
                "MERRA-2-ийн цасан бүрхүүлийг Монгол дээр MODIS-той тохируулсан (docs/METHODS.md); 50 км-ийн нүд нэг хөндийн мөсөн царцдасыг (хар зуд) харуулж чадахгүй.")],
          }) },
      ],
    },
    {
      id: "fire-today", tag: "hazard",
      title: B("How fire-prone is the land around Ulaanbaatar on a given day?", "Улаанбаатар орчмын газар тухайн өдөр түймэрт хэр өртөмтгий вэ?"),
      question: B("Landsat and ERA5-Land pixels through Google Earth Engine, on dates you choose; a relative map, not a probability.",
        "Google Earth Engine-ээр Landsat ба ERA5-Land пиксел, таны сонгосон өдрүүдэд; магадлал биш, харьцангуй зураг."),
      steps: [
        { action: { risk: { type: "fire", date: "2025-04-27" } },
          title: B("Spring, after the snow", "Хавар, цасны дараа"),
          text: B("Six factors per 100 m cell: surface temperature and NDMI from a cloud-free Landsat scene, vapour-pressure deficit, wind and soil water at the acquisition hour, and the previous seven days of rain from ERA5-Land. Only vegetated land is classed, and the classes are ranks within this box and date.",
            "100 м-ийн нүд бүрт зургаан хүчин зүйл: үүлгүй Landsat зургаас гадаргын температур ба NDMI, авсан цагийн агаарын хуурайшилт (VPD), салхи, хөрсний ус, ERA5-Land-аас өмнөх долоо хоногийн бороо. Зөвхөн ургамалтай газрыг ангилах бөгөөд ангилал нь энэ хайрцаг, энэ өдрийн доторх эрэмбэ."),
          evidence: (c) => (c.risk ? B(`${c.risk.scene} · scene cloud ${c.fmt(c.risk.cloud, 2)} % · ${c.nf(c.risk.n)} classified cells · acquired ${c.risk.when} UTC`,
            `${c.risk.scene} · зургийн үүлшил ${c.fmt(c.risk.cloud, 2)} % · ${c.nf(c.risk.n)} ангилсан нүд · авсан ${c.risk.when} UTC`) : NA) },
        { action: { risk: { type: "fire", date: "2025-10-04" } },
          title: B("Autumn", "Намар"),
          text: B("The same box on another cloud-free Landsat pass. Straight-edged blocks are ERA5-Land's 11 km cells showing through, not 100 m detail; the Landsat factors vary within them.",
            "Ижил хайрцаг, өөр нэг үүлгүй Landsat өнгөрөлт. Шулуун ирмэгтэй блокууд нь 100 м-ийн нарийвчлал биш, ERA5-Land-ийн 11 км-ийн нүд харагдаж байгаа нь; Landsat-ын хүчин зүйлс тэдгээрийн дотор өөрчлөгдөнө."),
          evidence: (c) => (c.risk ? B(`${c.risk.scene} · scene cloud ${c.fmt(c.risk.cloud, 2)} % · ${c.nf(c.risk.n)} classified cells · acquired ${c.risk.when} UTC`,
            `${c.risk.scene} · зургийн үүлшил ${c.fmt(c.risk.cloud, 2)} % · ${c.nf(c.risk.n)} ангилсан нүд · авсан ${c.risk.when} UTC`) : NA) },
        { action: {}, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("What a one-day susceptibility map is, and is not.", "Нэг өдрийн өртөмтгий байдлын зураг юу вэ, юу биш вэ."),
          verdict: (c) => ({
            what: B("A relative fire-susceptibility map for one day and one box: the rank of each vegetated cell among its neighbours on six physical factors.",
              "Нэг өдөр, нэг хайрцгийн түймэрт өртөмтгий байдлын харьцангуй зураг: ургамалтай нүд бүрийн зургаан физик хүчин зүйлээрх хөршүүдийнхээ дундах эрэмбэ."),
            where: c.risk ? B(`${c.nf(c.risk.n)} vegetated cells at 100 m; built-up land, water and bare rock are left blank.`, `100 м-д ${c.nf(c.risk.n)} ургамалтай нүд; барилгажсан газар, ус, нүцгэн хад хоосон үлдэнэ.`) : NA,
            howmuch: B("Five equal-width classes of a 0–1 rank score; no physical unit.", "0–1 эрэмбийн онооны таван тэнцүү өргөнтэй ангилал; физик нэгжгүй."),
            significant: B("Not a test: ranks carry no p-value. “Very high” exists on every date, wet or dry.", "Тест биш: эрэмбэ p утгагүй. «Маш өндөр» ангилал нойтон, хуурай ямар ч өдөр байна."),
            when: B("Any day with a 0–2 % cloud Landsat pass covering the whole box; dates are archived as they are produced.", "Хайрцгийг бүтэн хамарсан 0–2 % үүлтэй Landsat өнгөрөлттэй ямар ч өдөр; огноонуудыг үүсгэх бүрт архивлана."),
            caveats: [B("Four of the six factors come from ERA5-Land at ~11 km; Landsat thermal is ~100 m; the fuel mask is ESA WorldCover 2021.", "Зургаан хүчин зүйлийн дөрөв нь ~11 км-ийн ERA5-Land-аас; Landsat-ын дулааны суваг ~100 м; шатах ургамлын маск нь ESA WorldCover 2021."),
              B("Not calibrated against fire records; use it to compare places on one day, not days with each other.", "Түймрийн бүртгэлтэй тохируулаагүй; нэг өдрийн газруудыг харьцуулахад ашиглана, өдрүүдийг хооронд нь биш.")],
          }) },
      ],
    },
    {
      id: "when-will-we-know", tag: "method",
      title: B("When will we know? The year a trend becomes detectable", "Хэзээ мэдэх вэ? Чиг илрэх он"),
      question: B("Soil wetness over Mongolia: a small trend, a noisy record, and an honest answer instead of “no trend”.",
        "Монголын хөрсний чийг: жижиг чиг, шуугиантай бүртгэл, «чиг алга» гэхийн оронд шударга хариулт."),
      steps: [
        { action: { scene: "mn-soil", view: "map", layer: "trend", season: "all", years: "full", zoom: "reset", sel: null },
          title: B("Root-zone soil wetness", "Үндэсний давхаргын хөрсний чийг"),
          text: B("A 0–1 index from MERRA-2, 1981–2025. Most cells are faded: whatever is happening is not yet separable from year-to-year noise. The tool says so, instead of “no trend”.",
            "MERRA-2-ийн 0–1 индекс, 1981–2025. Ихэнх нүд бүдэг: юу ч болж байсан жил хоорондын шуугианаас хараахан ялгарахгүй. Хэрэгсэл «чиг алга» гэхийн оронд ингэж хэлнэ."),
          evidence: (c) => join(B(`Mongolia: ${meanLine(c, c.rs, c.unit).en}`, `Монгол: ${meanLine(c, c.rs, c.unit).mn}`), B(`${c.nf(c.k.fdr)} significant, ${c.nf(c.k.not_yet)} not yet detectable of ${c.nf(c.k.valid)}`, `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr)} нь ач холбогдолтой, ${c.nf(c.k.not_yet)} нь хараахан илрэхгүй`)) },
        { action: { layer: "detect" },
          title: B("The smallest trend this record could detect", "Энэ бүртгэлийн илрүүлж чадах хамгийн бага чиг"),
          text: B("For each cell: the smallest trend detectable with 90 % power given its noise and its month-to-month memory φ. Where the measured trend is below it, “not detected” is the expected outcome even if the trend is real.",
            "Нүд бүрт: шуугиан ба сар хоорондын санах ой φ-г тооцон 90 %-ийн хүчээр илрүүлж чадах хамгийн бага чиг. Хэмжсэн чиг үүнээс бага газарт чиг бодит байсан ч «илрээгүй» гэсэн үр дүн гарах нь хүлээгдэж буй зүйл."),
          evidence: (c) => B(`Mongolia mean: measured ${c.signed(c.rs.sen)} vs smallest detectable ±${c.fmt(c.rs.mdt)} ${c.unit} per decade; noise memory φ = ${c.fmt(c.rs.phi, 2)}`,
            `Монголын дундаж: хэмжсэн ${c.signed(c.rs.sen)}, илрүүлж чадах хамгийн бага ±${c.fmt(c.rs.mdt)} ${c.unit} арван жилд; шуугианы санах ой φ = ${c.fmt(c.rs.phi, 2)}`) },
        { action: { layer: "emerge" },
          title: B("The year it would show", "Харагдах он"),
          text: B("If the measured trend continues, this is the year it reaches 90 % detection probability, with a range from the Sen confidence interval widened for the noise estimates. In our Monte Carlo the range covers the true value 92–99 % of the time.",
            "Хэмжсэн чиг үргэлжилбэл 90 %-ийн илрэх магадлалд хүрэх он; муж нь шуугианы тооцоонд өргөсгөсөн Sen-ий итгэлийн завсраас гарна. Манай Монте-Карло туршилтад муж бодит утгыг 92–99 % тохиолдолд хамардаг."),
          evidence: (c) => B(`Mongolia mean: ${c.detectSentence(c.det(c.rs))}`, `Монголын дундаж: ${c.detectSentence(c.det(c.rs))}`) },
        { action: { layer: "trend" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("An answer with a date on it.", "Огноотой хариулт."),
          verdict: (c) => ({
            what: B(`Root-zone soil wetness over Mongolia: ${trendWord(c, c.rs).en}.`, `Монголын үндэсний давхаргын хөрсний чийг: ${trendWord(c, c.rs).mn}.`),
            where: B(`${c.nf(c.k.fdr)} of ${c.nf(c.k.valid)} cells significant after FDR; ${c.nf(c.k.not_yet)} not yet detectable.`, `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr)} нь FDR-ийн дараа ач холбогдолтой; ${c.nf(c.k.not_yet)} хараахан илрэхгүй.`),
            howmuch: B(`Country mean ${meanLine(c, c.rs, c.unit).en}; smallest detectable ±${c.fmt(c.rs.mdt)}.`, `Улсын дундаж ${meanLine(c, c.rs, c.unit).mn}; илрүүлж чадах хамгийн бага ±${c.fmt(c.rs.mdt)}.`),
            significant: B(`Corrected p ${c.fmtP(c.rs.p_mk)}.`, `Засварласан p ${c.fmtP(c.rs.p_mk)}.`),
            when: whenLine(c, c.rs),
            caveats: [B("NASA POWER stores two decimals; for a 0–1 index many values tie and some cells get a Sen slope of exactly 0. The tie-corrected tests stay valid; the slope is coarse there.",
              "NASA POWER хоёр орны нарийвчлалтай хадгалдаг; 0–1 индексийн олон утга давхцаж, зарим нүдний Sen-ий налуу яг 0 болно. Давхцал засварласан тестүүд хүчинтэй хэвээр; тэнд налуу бүдүүвч."),
              B("If noise has memory beyond AR(1), every test here is too liberal (docs/METHODS.md, Known limits).", "Шуугиан AR(1)-ээс урт санах ойтой бол эндэх бүх тест хэт зөөлөн (docs/METHODS.md, Мэдэгдэж буй хязгаар).")],
          }) },
      ],
    },
    {
      id: "known-truth", tag: "method",
      title: B("Can the detective be fooled? A test with planted trends", "Мөрдөгчийг хуурч болох уу? Суулгасан чигтэй тест"),
      question: B("A synthetic field where the answer is known, scored naive against FDR.", "Хариулт нь мэдэгдэж буй хиймэл талбар; энгийн тестийг FDR-тэй харьцуулан онооллоо."),
      steps: [
        { action: { scene: "synthetic-truth", view: "map", layer: "truth", zoom: "reset", sel: null },
          title: B("What was planted", "Юу суулгасан бэ"),
          text: B("One northern region was given a warming trend and one southern region a cooling trend. Everything else is noise with month-to-month memory and spatial smoothing, like real fields.",
            "Хойд хэсгийн нэг бүсэд дулаарах, өмнөд хэсгийн нэг бүсэд хөрөх чиг суулгасан. Бусад бүх зүйл бодит талбар шиг сар хоорондын санах ой, орон зайн тэгшитгэлтэй шуугиан."),
          evidence: (c) => B(`${c.nf(c.truthCells)} of ${c.nf(c.k.valid)} cells carry a planted trend.`, `${c.nf(c.k.valid)} нүдний ${c.nf(c.truthCells)} нь суулгасан чигтэй.`) },
        { action: { layer: "naive" },
          title: B("A naive test", "Энгийн тест"),
          text: B("p < 0.05 in each cell, no correction. Many flagged cells lie outside the planted regions: false discoveries created simply by testing thousands of cells.",
            "Нүд бүрт p < 0.05, засваргүй. Тэмдэглэгдсэн олон нүд суулгасан бүсээс гадна байна: зүгээр л хэдэн мянган нүдийг шалгаснаас үүссэн хуурамч нээлтүүд."),
          evidence: (c) => (c.truth ? B(`${c.nf(c.k.naive)} cells flagged; ${c.nf(c.truth.naive.fp)} of them false (${pct(c.truth.naive.fdp)} of the flags); power ${pct(c.truth.naive.power)}.`,
            `${c.nf(c.k.naive)} нүд тэмдэглэгдсэн; үүний ${c.nf(c.truth.naive.fp)} нь хуурамч (тэмдэглэгдсэний ${pct(c.truth.naive.fdp)}); хүч ${pct(c.truth.naive.power)}.`) : NA) },
        { action: { layer: "trend" },
          title: B("After the false discovery rate", "Хуурамч нээлтийн хувийн дараа"),
          text: B("Benjamini–Hochberg across the map (α_FDR = 2α, Wilks 2016). Fewer flags, and most of them are real. This is the default map everywhere in the tool.",
            "Газрын зураг даяар Benjamini–Hochberg (α_FDR = 2α, Wilks 2016). Тэмдэглэгээ цөөрч, ихэнх нь бодит. Энэ бол хэрэгслийн хаа сайгүй анхдагч газрын зураг."),
          evidence: (c) => (c.truth ? B(`${c.nf(c.k.fdr)} cells flagged; ${c.nf(c.truth.fdr.fp)} false (${pct(c.truth.fdr.fdp)}); power ${pct(c.truth.fdr.power)}; FDR threshold p* = ${c.fmt(c.res.pstar, 3)}.`,
            `${c.nf(c.k.fdr)} нүд тэмдэглэгдсэн; ${c.nf(c.truth.fdr.fp)} нь хуурамч (${pct(c.truth.fdr.fdp)}); хүч ${pct(c.truth.fdr.power)}; FDR босго p* = ${c.fmt(c.res.pstar, 3)}.`) : NA) },
        { action: { layer: "trend" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("What the validation shows.", "Баталгаажуулалт юу харуулж байна."),
          verdict: (c) => ({
            what: B("The method finds the planted trends and keeps false discoveries near the nominal rate.", "Арга суулгасан чигийг олж, хуурамч нээлтийг нэрлэсэн түвшний орчимд барина."),
            where: B("The two planted regions; false flags are scattered everywhere in the naive map.", "Суулгасан хоёр бүс; энгийн зурагт хуурамч тэмдэглэгээ хаа сайгүй тархсан."),
            howmuch: c.truth ? B(`False share of the flags: naive ${pct(c.truth.naive.fdp)} → FDR ${pct(c.truth.fdr.fdp)}.`, `Тэмдэглэгдсэний хуурамч хувь: энгийн ${pct(c.truth.naive.fdp)} → FDR ${pct(c.truth.fdr.fdp)}.`) : NA,
            significant: B(`FDR threshold p* = ${c.fmt(c.res.pstar, 3)} at α = ${c.alpha}.`, `α = ${c.alpha} үед FDR босго p* = ${c.fmt(c.res.pstar, 3)}.`),
            when: B("Not applicable: the field is synthetic.", "Хамаарахгүй: талбар хиймэл."),
            caveats: [B("Power falls with FDR: fewer true cells are found. The trade is deliberate; the naive map is one click away.", "FDR-тэй хүч буурна: бодит нүд цөөн олдоно. Энэ бол санаатай сонголт; энгийн зураг нэг товшилтын зайд."),
              B("Monte Carlo (Method tab): the AR(1)-modelled Hamed-Rao test stays near 5 % false positives where the published variant reaches 15 % at φ = 0.6.", "Монте-Карло (Арга зүй таб): AR(1) загварчилсан Hamed-Rao тест φ = 0.6 үед хэвлэгдсэн хувилбар 15 % хүрэхэд 5 %-ийн орчимд хуурамч эерэг хэвээр байна.")],
          }) },
      ],
    },
    // ------------------------------------------------------------ MODIS scenes at 1 km and 5 km (docs/MODIS_TRENDS.md)
    // These four cases need the scenes that `python -m trend_detective modis-trend` builds; they are listed
    // only when their scenes are in the index (`requires`), so a site without the MODIS data still works.
    {
      id: "ub-surface", tag: "mongolia", requires: ["ub-modis-lst-day", "ub-modis-lst-night"],
      title: B("Ulaanbaatar at 1 km: is the city's surface warming faster than the land around it?",
        "Улаанбаатар 1 км-д: хотын гадаргуу эргэн тойрны газраас хурдан дулаарч байна уу?"),
      question: B("Terra MODIS land surface temperature, one pixel per kilometre, 2000–2025: the city box against the 160 km box, by day and by night, with Terra's orbit drift tested as a step.",
        "Terra MODIS-ийн газрын гадаргын температур, километр бүрт нэг пиксел, 2000–2025: хотын хайрцгийг 160 км-ийн хайрцагтай өдөр, шөнөөр харьцуулж, Terra-гийн тойргийн шилжилтийг алхамаар шалгасан."),
      steps: [
        { action: { scene: "ub-modis-lst-day", view: "map", layer: "trend", years: "full", zoom: "reset", sel: null },
          title: B("160 km around the capital, one pixel per kilometre", "Нийслэлийн эргэн тойрны 160 км, километр бүрт нэг пиксел"),
          text: B("Daytime clear-sky land surface temperature from MOD11A2 (Terra, about 10:30 local), 2000–2025, each cell one 1 km pixel: up to 25,600 cells where the 50 km map has about ten. One value per year (the mean of the monthly means), the same Mann-Kendall test, the same false discovery rate across the box. This is the temperature of the ground, roofs and roads, not the air at 2 m.",
            "MOD11A2-ийн (Terra, орон нутгийн цагаар ~10:30) өдрийн цэлмэг тэнгэрийн газрын гадаргын температур, 2000–2025, нүд бүр нэг 1 км пиксел: 50 км-ийн зурагт арав орчим нүд байсан газарт 25,600 хүртэл нүд. Жилд нэг утга (сарын дунджуудын дундаж), ижил Mann-Kendall тест, хайрцаг даяар ижил хуурамч нээлтийн хувь. Энэ бол 2 м-ийн агаар биш, газар, дээвэр, замын температур."),
          evidence: (c) => join(B(`160 km box mean: ${meanLine(c, c.rs, c.unit).en}`, `160 км хайрцгийн дундаж: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { layer: "trend", box: UB_CITY, zoom: { lon: 106.9, lat: 47.91, z: 2.5 } },
          title: B("The city box", "Хотын хайрцаг"),
          text: B("A box of about 24 × 16 km over the built-up city averages its cells and runs the same tests on the mean series. The question is not whether the city is warmer than the steppe (it is; the urban heat island is a level) but whether its trend differs. Compare the box trend with the 160 km mean of the first step.",
            "Барилгажсан хотын дээрх ойролцоогоор 24 × 16 км-ийн хайрцаг нүднүүдээ дундажлаад дундаж цуваанд ижил тестүүдийг ажиллуулна. Асуулт нь хот хээрээс дулаан эсэх биш (тийм; хотын дулааны арал бол түвшин), харин түүний чиг ялгаатай эсэх. Хайрцгийн чигийг эхний алхмын 160 км-ийн дундажтай харьцуул."),
          evidence: (c) => boxVsMean(c, B("City box", "Хотын хайрцаг")) },
        { action: { scene: "ub-modis-lst-night", layer: "trend", years: "full", box: UB_CITY, zoom: { lon: 106.9, lat: 47.91, z: 2.5 } },
          title: B("The same box at night", "Ижил хайрцаг шөнөөр"),
          text: B("Night-time surface temperature (Terra, about 22:30 local). The urban heat island is strongest at night, when the city's stone and asphalt give back the day's heat. A night trend that outruns the box mean is the signature of a growing city; one that matches it is regional warming.",
            "Шөнийн гадаргын температур (Terra, орон нутгийн цагаар ~22:30). Хотын чулуу, асфальт өдрийн дулаанаа буцааж өгдөг шөнө хотын дулааны арал хамгийн хүчтэй. Хайрцгийн дундажаас давсан шөнийн чиг бол өсөж буй хотын шинж; түүнтэй тохирох чиг бол бүс нутгийн дулаарал."),
          evidence: (c) => boxVsMean(c, B("City box at night", "Хотын хайрцаг шөнөөр")) },
        { action: { scene: "ub-modis-lst-day", layer: "steps", years: "full", sel: null, zoom: "reset" },
          title: B("Terra's orbit drift, tested as a step", "Terra-гийн тойргийн шилжилт, алхамаар шалгасан"),
          text: B("Terra's last orbit-raising manoeuvre was on 27 February 2020; since then its morning crossing has drifted earlier (10:15 by autumn 2022), with a lower sun and cooler daytime surfaces. The tool lists it as a documented transition and tests every cell for a step at 2020-03. A flagged step says the last years are sampled differently, not that the climate jumped.",
            "Terra-гийн тойргоо өргөх сүүлчийн маневр 2020 оны 2-р сарын 27-нд болсон; түүнээс хойш өглөөний өнгөрөлт нь эрт болж (2022 оны намар 10:15), нар намхан, өдрийн гадаргуу сэрүүн болсон. Хэрэгсэл үүнийг баримтжуулсан шилжилт гэж бүртгэж, нүд бүрийг 2020-03-д алхамтай эсэхээр шалгана. Тэмдэглэгдсэн алхам нь уур амьсгал үсэрсэн биш, сүүлийн жилүүд өөрөөр түүвэрлэгдсэнийг хэлнэ."),
          evidence: (c) => stepsLine(c) },
        { action: { years: [2000, 2019], layer: "trend", sel: null },
          title: B("Before the drift: 2000–2019", "Шилжилтээс өмнө: 2000–2019"),
          text: B("The same cells re-tested on the twenty years before the manoeuvre. If the warming survives without the drifted years, the drift is not what made it. A shorter record widens every confidence interval and raises the count of “not yet detectable” cells.",
            "Ижил нүднүүдийг маневраас өмнөх хорин жилээр дахин шалгав. Шилжсэн жилүүдгүйгээр дулаарал хадгалагдвал шилжилт түүнийг үүсгээгүй. Богино бүртгэл итгэлийн завсар бүрийг өргөсгөж, «хараахан илрэхгүй» нүдний тоог нэмнэ."),
          evidence: (c) => join(B(`${c.yrs}: 160 km box mean ${meanLine(c, c.rs, c.unit).en}`, `${c.yrs}: 160 км хайрцгийн дундаж ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { scene: "ub-modis-lst-day", years: "full", layer: "trend", box: UB_CITY, zoom: { lon: 106.9, lat: 47.91, z: 2.5 } }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions for the capital's surface at 1 km.", "Нийслэлийн гадаргын дөрвөн асуулт 1 км-д."),
          verdict: (c) => {
            const s = c.sel, ratio = s && c.rs && c.rs.sen ? c.fmt(s.sen / c.rs.sen, 2) : null;
            return {
              what: B(`Daytime land surface temperature in the 160 km box: ${trendWord(c, c.rs).en}; in the city box: ${s ? trendWord(c, s).en : "?"}.`,
                `160 км хайрцгийн өдрийн газрын гадаргын температур: ${trendWord(c, c.rs).mn}; хотын хайрцагт: ${s ? trendWord(c, s).mn : "?"}.`),
              where: B(`${c.nf(c.k.fdr_up)} cells warming and ${c.nf(c.k.fdr_down)} cooling after FDR, of ${c.nf(c.k.valid)} at 1 km.`,
                `1 км-ийн ${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_up)} нь дулаарч, ${c.nf(c.k.fdr_down)} нь хөрч байна (FDR-ийн дараа).`),
              howmuch: B(`160 km box ${meanLine(c, c.rs, c.unit).en}; city box ${s ? meanLine(c, s, c.unit).en : "—"}${ratio ? ` (${ratio} × the box mean)` : ""}.`,
                `160 км хайрцаг ${meanLine(c, c.rs, c.unit).mn}; хотын хайрцаг ${s ? meanLine(c, s, c.unit).mn : "—"}${ratio ? ` (хайрцгийн дундажаас ${ratio} дахин)` : ""}.`),
              significant: B(`Box mean corrected p ${c.fmtP(c.rs.p_mk)}; city box ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).en}.`,
                `Хайрцгийн дундажийн засварласан p ${c.fmtP(c.rs.p_mk)}; хотын хайрцаг ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).mn}.`),
              when: whenLine(c, s || c.rs),
              caveats: [B("Skin temperature under clear skies at one overpass time, not the 2 m air temperature of a station or a reanalysis; a cloudier decade is also a differently sampled one.",
                "Нэг өнгөрөлтийн цагт, цэлмэг тэнгэрт хэмжсэн гадаргын температур; станц, дахин шинжилгээний 2 м-ийн агаарын температур биш. Үүлэрхэг арван жил бол өөрөөр түүвэрлэгдсэн арван жил."),
                B("Terra's orbit drift since 2020 is tested as a step in every cell (step 4) and the window 2000–2019 is one click away (step 5); the record is 26 years, so “not yet detectable” is common.",
                  "2020 оноос хойших Terra-гийн тойргийн шилжилтийг нүд бүрт алхамаар шалгасан (4-р алхам), 2000–2019 цонх нэг товшилтын зайд (5-р алхам); бүртгэл 26 жил тул «хараахан илрэхгүй» түгээмэл."),
                B("Two means over the same place are not independent samples: the difference between the city box and the 160 km box carries no p-value here.",
                  "Нэг газрын хоёр дундаж бол хараат бус түүвэр биш: хотын хайрцаг ба 160 км-ийн хайрцгийн зөрүүнд энд p-утга өгөхгүй.")],
            };
          } },
      ],
    },
    {
      id: "gobi-mines-1km", tag: "mongolia", requires: ["gobi-modis-ndvi", "gobi-modis-lst-day"],
      title: B("The South Gobi mines at 1 km: has the ground around Tavan Tolgoi and Oyu Tolgoi changed?",
        "Өмнөговийн уурхайнууд 1 км-д: Таван толгой, Оюу толгойн эргэн тойрны газар өөрчлөгдсөн үү?"),
      question: B("Growing-season greenness and daytime surface temperature from Terra MODIS, 2000–2025, in 20 km boxes around the pits against the 160 km box.",
        "Terra MODIS-ийн ургалтын улирлын ногоон байдал ба өдрийн гадаргын температур, 2000–2025, карьеруудын эргэн тойрны 20 км-ийн хайрцгийг 160 км-ийн хайрцагтай харьцуулсан нь."),
      steps: [
        { action: { scene: "gobi-modis-ndvi", view: "map", layer: "trend", years: "full", zoom: "reset", sel: null },
          title: B("Greenness May–September", "5–9-р сарын ногоон байдал"),
          text: B("NDVI from MOD13A3 at 1 km, the mean of the five growing-season months, one value per year, 2000–2025, in a 160 km box that holds both mines. The Gobi is sparsely vegetated, so NDVI is low and its trend small; a year with a cloudy month is excluded rather than filled.",
            "MOD13A3-ийн 1 км-ийн NDVI, ургалтын улирлын таван сарын дундаж, жилд нэг утга, 2000–2025, хоёр уурхайг хоёуланг нь агуулсан 160 км-ийн хайрцагт. Говь ургамал сийрэгтэй тул NDVI бага, чиг нь жижиг; үүлэрхэг сартай жилийг нөхөхгүй, хасна."),
          evidence: (c) => join(B(`160 km box mean: ${meanLine(c, c.rs, c.unit).en}`, `160 км хайрцгийн дундаж: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { layer: "trend", box: TAVAN_TOLGOI, zoom: { lon: 105.49, lat: 43.63, z: 4 } },
          title: B("Tavan Tolgoi", "Таван толгой"),
          text: B("A 20 km box around the coal pits (their centre read off NASA HLS imagery). Open-pit mining at Ukhaa Khudag began in 2009 and exports to China in 2011, so most of the pits, dumps and haul roads grew inside this record. Bare ground and dust lower NDVI; compare the box with the 160 km mean.",
            "Нүүрсний карьеруудын эргэн тойрны 20 км-ийн хайрцаг (төвийг нь NASA HLS зургаас уншсан). Ухаа худагт ил уурхайн олборлолт 2009 онд, Хятад руу экспорт 2011 онд эхэлсэн тул карьер, овоолго, тээврийн замын ихэнх нь энэ бүртгэлийн дотор өссөн. Нүцгэн газар, тоос NDVI-г бууруулна; хайрцгийг 160 км-ийн дундажтай харьцуул."),
          evidence: (c) => boxVsMean(c, B("Tavan Tolgoi box", "Таван толгойн хайрцаг")) },
        { action: { layer: "trend", box: OYU_TOLGOI, zoom: { lon: 106.843, lat: 43.008, z: 4 } },
          title: B("Oyu Tolgoi", "Оюу толгой"),
          text: B("A 20 km box around the copper-gold mine, which shipped its first concentrate in July 2013. The same test at the same scale: a mine footprint shows as a browning box only if it is large against 1 km pixels and against the year-to-year swings of a desert's greenness.",
            "2013 оны 7-р сард анхны баяжмалаа ачуулсан зэс-алтны уурхайн эргэн тойрны 20 км-ийн хайрцаг. Ижил масштабад ижил тест: уурхайн ул мөр нь 1 км-ийн пиксел болон цөлийн ногоон байдлын жил хоорондын хэлбэлзэлтэй харьцуулахад том байж л бор хайрцаг болж харагдана."),
          evidence: (c) => boxVsMean(c, B("Oyu Tolgoi box", "Оюу толгойн хайрцаг")) },
        { action: { scene: "gobi-modis-lst-day", layer: "trend", years: "full", box: TAVAN_TOLGOI, zoom: { lon: 105.49, lat: 43.63, z: 4 } },
          title: B("The same box in daytime surface temperature", "Ижил хайрцаг өдрийн гадаргын температураар"),
          text: B("A pit and its waste dumps are darker and drier than the steppe, so bare ground warms faster in the sun. A daytime surface warming at Tavan Tolgoi beyond the 160 km mean is the thermal fingerprint of ground laid bare; regional warming alone would warm the box and its surroundings alike.",
            "Карьер, түүний овоолго хээрээс бараан, хуурай тул нүцгэн газар наранд хурдан халдаг. Таван толгойд 160 км-ийн дундажаас давсан өдрийн гадаргын дулаарал бол нүцгэрсэн газрын дулааны ул мөр; зөвхөн бүс нутгийн дулаарал бол хайрцаг, эргэн тойрныг адилхан дулаацуулна."),
          evidence: (c) => boxVsMean(c, B("Tavan Tolgoi box, daytime surface", "Таван толгойн хайрцаг, өдрийн гадаргуу")) },
        { action: { scene: "gobi-modis-ndvi", years: "full", layer: "trend", box: TAVAN_TOLGOI, zoom: { lon: 105.49, lat: 43.63, z: 4 } }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions for the ground around the mines.", "Уурхайн эргэн тойрны газрын дөрвөн асуулт."),
          verdict: (c) => {
            const s = c.sel;
            return {
              what: B(`Growing-season greenness in the 160 km box: ${trendWord(c, c.rs).en}; in the 20 km box at Tavan Tolgoi: ${s ? trendWord(c, s).en : "?"}.`,
                `160 км хайрцгийн ургалтын улирлын ногоон байдал: ${trendWord(c, c.rs).mn}; Таван толгойн 20 км-ийн хайрцагт: ${s ? trendWord(c, s).mn : "?"}.`),
              where: B(`${c.nf(c.k.fdr_up)} cells greening and ${c.nf(c.k.fdr_down)} browning after FDR, of ${c.nf(c.k.valid)} at 1 km.`,
                `1 км-ийн ${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_up)} нь ногоорч, ${c.nf(c.k.fdr_down)} нь борлож байна (FDR-ийн дараа).`),
              howmuch: B(`160 km box ${meanLine(c, c.rs, c.unit).en}; Tavan Tolgoi box ${s ? meanLine(c, s, c.unit).en : "—"}.`,
                `160 км хайрцаг ${meanLine(c, c.rs, c.unit).mn}; Таван толгойн хайрцаг ${s ? meanLine(c, s, c.unit).mn : "—"}.`),
              significant: B(`Box mean corrected p ${c.fmtP(c.rs.p_mk)}; Tavan Tolgoi box ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).en}.`,
                `Хайрцгийн дундажийн засварласан p ${c.fmtP(c.rs.p_mk)}; Таван толгойн хайрцаг ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).mn}.`),
              when: whenLine(c, s || c.rs),
              caveats: [B("A mine opening is a step, not a trend; the step tests here only know documented source changes (Terra's drift), so read the box series in the details pane around 2009–2013 before calling a slope a mine effect. Daytime surface temperature at the same box (step 4) is the second witness.",
                "Уурхай нээгдэх нь чиг биш, алхам; эндэх алхмын тест зөвхөн баримтжуулсан эх сурвалжийн өөрчлөлтийг (Terra-гийн шилжилт) мэднэ, тиймээс налууг уурхайн нөлөө гэхээсээ өмнө хайрцгийн цувааг дэлгэрэнгүй самбарт 2009–2013 оны орчим уншина уу. Ижил хайрцгийн өдрийн гадаргын температур (4-р алхам) бол хоёр дахь гэрч."),
                B("NDVI needs all five months clear; a 1 km pixel mixes pit, dump, road and steppe, and dust from the pits and the haul road can lower greenness downwind.",
                  "NDVI-д таван сар бүгд цэлмэг байх шаардлагатай; 1 км-ийн пиксел карьер, овоолго, зам, хээрийг холино, карьер болон тээврийн замын тоос салхины доод талд ногоон байдлыг бууруулж болно."),
                B("Twenty-six years in a desert with large year-to-year swings: “not yet detectable” is the honest answer for many cells.",
                  "Жил хоорондын хэлбэлзэл ихтэй цөлд хорин зургаан жил: олон нүдэнд «хараахан илрэхгүй» бол шударга хариулт.")],
            };
          } },
      ],
    },
    {
      id: "khovsgol-snow", tag: "mongolia", requires: ["khovsgol-modis-snowdays", "khovsgol-modis-lst-night"],
      title: B("Khövsgöl at 1 km: are winters losing snow-covered days?", "Хөвсгөл 1 км-д: өвөл цастай өдрөө алдаж байна уу?"),
      question: B("Snow-covered days November–March counted from daily Terra MODIS at 500 m, 25 winters, with winter-night surface temperature as the second witness.",
        "Terra MODIS-ийн 500 м-ийн өдөр тутмын өгөгдлөөс тоолсон 11–3-р сарын цастай өдөр, 25 өвөл; хоёр дахь гэрч нь шөнийн гадаргын температур."),
      steps: [
        { action: { scene: "khovsgol-modis-snowdays", view: "map", layer: "trend", years: "full", zoom: "reset", sel: null },
          title: B("Snow-covered days per winter", "Нэг өвлийн цастай өдөр"),
          text: B("MOD10A1 flags a 500 m pixel as snow-covered when its NDSI is 40 or more; cloudy and night observations are left out, each month's count is scaled to its length, and the five months November–March are summed: one number per winter, 2000/01 to 2024/25. Lake Khövsgöl is inland water in this product and carries no value.",
            "MOD10A1 500 м-ийн пикселийн NDSI 40 ба түүнээс дээш бол цастай гэж тэмдэглэнэ; үүлтэй, шөнийн ажиглалтыг орхиж, сар бүрийн тоог уртад нь тааруулж, 11–3-р сарын таван сарыг нэмнэ: нэг өвөлд нэг тоо, 2000/01-ээс 2024/25. Хөвсгөл нуур энэ бүтээгдэхүүнд дотоод ус тул утгагүй."),
          evidence: (c) => join(B(`160 km box mean: ${meanLine(c, c.rs, c.unit).en}`, `160 км хайрцгийн дундаж: ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { layer: "trend", place: "Mörön", zoom: { lon: 100.162, lat: 49.634, z: 2.5 } },
          title: B("Mörön", "Мөрөн"),
          text: B("The 1 km cell holding the aimag centre; its 25 winters, confidence interval and the year its trend becomes detectable are in the details pane. Snow is the dzud ingredient that satellites see directly; the reanalysis only models it.",
            "Аймгийн төвийг агуулсан 1 км-ийн нүд; түүний 25 өвөл, итгэлийн завсар, чиг нь илрэх он дэлгэрэнгүй самбарт байна. Цас бол хиймэл дагуул шууд хардаг зудын орц; дахин шинжилгээ түүнийг зөвхөн загварчилдаг."),
          evidence: (c) => cellLine(c, B("Mörön cell", "Мөрөнгийн нүд")) },
        { action: { scene: "khovsgol-modis-lst-night", layer: "trend", years: "full", place: "Mörön", zoom: { lon: 100.162, lat: 49.634, z: 2.5 } },
          title: B("Nights at the surface", "Шөнийн гадаргуу"),
          text: B("Night-time surface temperature (all months, annual mean) at the same cell. Snow insulates the ground and reflects the sun; fewer snow days and warmer night surfaces go together, and a cell showing both is harder to dismiss as a cloud-sampling artifact.",
            "Ижил нүдний шөнийн гадаргын температур (бүх сар, жилийн дундаж). Цас газрыг дулаалж, нарыг ойлгодог; цастай өдөр цөөрөх, шөнийн гадаргуу дулаарах хоёр хамт явдаг бөгөөд хоёуланг нь үзүүлж буй нүдийг үүлний түүврийн хуурмаг гэж үгүйсгэхэд хэцүү."),
          evidence: (c) => cellLine(c, B("Mörön cell, night surface", "Мөрөнгийн нүд, шөнийн гадаргуу")) },
        { action: { scene: "khovsgol-modis-snowdays", layer: "emerge", years: "full", sel: null, zoom: "reset" },
          title: B("When would a snow trend show?", "Цасны чиг хэзээ харагдах вэ?"),
          text: B("Twenty-five winters is a short record for a quantity that swings by weeks from one winter to the next. The year-detectable layer gives, cell by cell, the winter by which a trend of the measured size would be detected with 90 % probability if it continues.",
            "Өвлөөс өвөлд долоо хоногоор хэлбэлздэг хэмжигдэхүүний хувьд хорин таван өвөл бол богино бүртгэл. Илрэх оны давхарга нүд бүрт хэмжсэн хэмжээтэй чиг үргэлжилбэл 90 %-ийн магадлалтайгаар илрэх өвлийг өгнө."),
          evidence: (c) => B(`160 km box mean: ${c.detectSentence(c.det(c.rs))}`, `160 км хайрцгийн дундаж: ${c.detectSentence(c.det(c.rs))}`) },
        { action: { scene: "khovsgol-modis-snowdays", years: "full", layer: "trend", place: "Mörön", zoom: { lon: 100.162, lat: 49.634, z: 2.5 } }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions for Khövsgöl's snow.", "Хөвсгөлийн цасны дөрвөн асуулт."),
          verdict: (c) => {
            const s = c.sel;
            return {
              what: B(`Snow-covered days per winter in the 160 km box: ${trendWord(c, c.rs).en}; at Mörön's cell: ${s ? trendWord(c, s).en : "?"}.`,
                `160 км хайрцгийн нэг өвлийн цастай өдөр: ${trendWord(c, c.rs).mn}; Мөрөнгийн нүдэнд: ${s ? trendWord(c, s).mn : "?"}.`),
              where: B(`${c.nf(c.k.fdr_down)} cells losing and ${c.nf(c.k.fdr_up)} gaining snow days after FDR, of ${c.nf(c.k.valid)} at 1 km.`,
                `1 км-ийн ${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_down)} нь цастай өдрөө алдаж, ${c.nf(c.k.fdr_up)} нь нэмж байна (FDR-ийн дараа).`),
              howmuch: B(`160 km box ${meanLine(c, c.rs, c.unit).en}; Mörön ${s ? meanLine(c, s, c.unit).en : "—"}.`,
                `160 км хайрцаг ${meanLine(c, c.rs, c.unit).mn}; Мөрөн ${s ? meanLine(c, s, c.unit).mn : "—"}.`),
              significant: B(`Box mean corrected p ${c.fmtP(c.rs.p_mk)}; Mörön ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).en}.`,
                `Хайрцгийн дундажийн засварласан p ${c.fmtP(c.rs.p_mk)}; Мөрөн ${s ? c.fmtP(s.p_mk) : "—"}; ${pstarLine(c).mn}.`),
              when: whenLine(c, s || c.rs),
              caveats: [B("NDSI ≥ 40 is the product's own threshold: thin or patchy snow below it does not count. Snow is counted on clear-sky days only, and snowfall days are cloudy, so the count leans towards snow-covered; a month with no clear observation is missing, and a winter with a missing month is excluded, never filled.",
                "NDSI ≥ 40 бол бүтээгдэхүүний өөрийн босго: түүнээс доош нимгэн, тасархай цас тоологдохгүй. Цасыг зөвхөн цэлмэг өдрүүдэд тоолдог бөгөөд цас орох өдөр үүлтэй тул тоо цастай тал руугаа хазайна; нэг ч цэлмэг ажиглалтгүй сар дутуу, дутуу сартай өвлийг нөхөхгүй, хасна."),
                B("Lake Khövsgöl and other inland water carry no value; a cloudier winter is a differently sampled one; Terra's orbit drift since 2020 is tested as a step in every cell.",
                  "Хөвсгөл нуур болон бусад дотоод ус утгагүй; үүлэрхэг өвөл бол өөрөөр түүвэрлэгдсэн өвөл; 2020 оноос хойших Terra-гийн тойргийн шилжилтийг нүд бүрт алхамаар шалгасан.")],
            };
          } },
      ],
    },
    {
      id: "skin-vs-air", tag: "method", requires: ["mn-modis-lst-day"],
      title: B("Do 1 km satellites and the 50 km model agree? Surface against air over Mongolia",
        "1 км-ийн хиймэл дагуул, 50 км-ийн загвар хоёр тохирох уу? Монгол дээрх гадаргуу ба агаар"),
      question: B("Terra's daytime land surface temperature at about 10 km against MERRA-2 air temperature at 50 km, the same 26 years, each cell against the cell that holds it.",
        "Terra-гийн ~10 км-ийн өдрийн газрын гадаргын температурыг MERRA-2-ийн 50 км-ийн агаарын температуртай ижил 26 жилд, нүд бүрийг агуулж буй нүдтэй нь тулгасан нь."),
      steps: [
        { action: { scene: "mn-modis-lst-day", view: "map", layer: "trend", years: "full", zoom: "reset", sel: null },
          title: B("The country at about 10 km", "Улс ~10 км-д"),
          text: B("Daytime clear-sky land surface temperature, 2000–2025, on cells of about 10 km (each the mean of the 2 × 2 climate-modelling-grid cells of 0.05° inside it, or 5 km when built through Earth Engine): tens of thousands of cells inside the border where MERRA-2 has 1,272. One value per year, the same tests, the FDR threshold set across all cells.",
            "Өдрийн цэлмэг тэнгэрийн газрын гадаргын температур, 2000–2025, ойролцоогоор 10 км-ийн нүдэнд (нүд бүр доторх 0.05°-ийн 2 × 2 уур амьсгалын загварын торын нүдний дундаж; Earth Engine-ээр бол 5 км): MERRA-2 1,272 нүдтэй байдаг хилийн дотор хэдэн арван мянган нүд. Жилд нэг утга, ижил тестүүд, FDR босгыг бүх нүдээр тогтооно."),
          evidence: (c) => join(B(`Mongolia (country mask): ${meanLine(c, c.rs, c.unit).en}`, `Монгол (улсын хилээр): ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { scene: "mn-t2m", years: [2000, 2025], season: "all", layer: "trend", zoom: "reset", sel: null },
          title: B("The same years in the reanalysis", "Ижил жилүүд дахин шинжилгээнд"),
          text: B("MERRA-2 air temperature at 2 m, restricted to 2000–2025 so that both records cover the same years. Every test is recomputed in the browser for the shorter window.",
            "MERRA-2-ийн 2 м-ийн агаарын температур, хоёр бүртгэл ижил жилүүдийг хамрахаар 2000–2025 оноор хязгаарласан. Богино цонхонд бүх тест хөтөч дээр дахин тооцогдоно."),
          evidence: (c) => join(B(`${c.yrs}: Mongolia mean ${meanLine(c, c.rs, c.unit).en}`, `${c.yrs}: Монголын дундаж ${meanLine(c, c.rs, c.unit).mn}`), cellsLine(c)) },
        { action: { scene: "mn-modis-lst-day", years: "full", layer: "trend", compare: { id: "mn-t2m", y0: 2000, y1: 2025 }, zoom: "reset", sel: null },
          title: B("Each cell against the cell that holds it", "Нүд бүрийг агуулж буй нүдтэй нь"),
          text: B("Split view: surface at about 10 km on the left, air at 50 km on the right. For every surface cell the tool finds the 50 km cell above it and compares the signs of the two Sen slopes. Skin and air are different quantities, clear sky and all sky different samples, so the sizes need not match; the signs should, over most of the country, if both records see the same climate.",
            "Хуваасан харагдац: зүүн талд ~10 км-ийн гадаргуу, баруун талд 50 км-ийн агаар. Гадаргын нүд бүрт хэрэгсэл түүний дээрх 50 км-ийн нүдийг олж, хоёр Sen-ий налуугийн тэмдгийг харьцуулна. Гадаргуу ба агаар өөр хэмжигдэхүүн, цэлмэг ба бүх тэнгэр өөр түүвэр тул хэмжээ тохирох албагүй; хоёр бүртгэл нэг уур амьсгалыг харж байвал тэмдэг улсын ихэнх хэсэгт тохирох ёстой."),
          evidence: (c) => agreeLine(c) },
        { action: { scene: "mn-modis-lst-day", years: "full", layer: "trend", compare: { id: "mn-t2m", y0: 2000, y1: 2025 }, zoom: "reset", sel: null }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("Two records, one country, the same years.", "Хоёр бүртгэл, нэг улс, ижил жилүүд."),
          verdict: (c) => {
            const x = crossGrid(c), ru = x && x.rs ? c.A.unitLabel(c.A.cmp.entry.sc.units) : "";
            return {
              what: B(`Daytime land surface temperature (about 10 km): ${trendWord(c, c.rs).en} over the country mean; MERRA-2 air temperature (50 km) over the same years: ${x && x.rs ? trendWord(c, x.rs).en : "open step 3"}.`,
                `Өдрийн газрын гадаргын температур (~10 км): улсын дундажид ${trendWord(c, c.rs).mn}; MERRA-2-ийн агаарын температур (50 км) ижил жилүүдэд: ${x && x.rs ? trendWord(c, x.rs).mn : "3-р алхмыг нээнэ үү"}.`),
              where: x ? B(`${pct(x.agree)} of ${c.nf(x.n)} surface cells share the sign of the 50 km cell above them; ${x.both ? `${pct(x.bothAgree)} of the ${c.nf(x.both)} cells significant in both` : "no cell is significant in both records"}.`,
                `Гадаргын ${c.nf(x.n)} нүдний ${pct(x.agree)} нь дээрх 50 км-ийн нүдтэйгээ ижил тэмдэгтэй; ${x.both ? `хоёуланд нь ач холбогдолтой ${c.nf(x.both)} нүдний ${pct(x.bothAgree)}` : "хоёр бүртгэлд хоёуланд нь ач холбогдолтой нүд алга"}.`) : NA,
              howmuch: B(`Surface ${meanLine(c, c.rs, c.unit).en}${x && x.rs ? `; air ${meanLine(c, x.rs, ru).en}` : ""}.`,
                `Гадаргуу ${meanLine(c, c.rs, c.unit).mn}${x && x.rs ? `; агаар ${meanLine(c, x.rs, ru).mn}` : ""}.`),
              significant: B(`Surface corrected p ${c.fmtP(c.rs.p_mk)}${x && x.rs ? `; air ${c.fmtP(x.rs.p_mk)}` : ""}; ${pstarLine(c).en}.`,
                `Гадаргын засварласан p ${c.fmtP(c.rs.p_mk)}${x && x.rs ? `; агаар ${c.fmtP(x.rs.p_mk)}` : ""}; ${pstarLine(c).mn}.`),
              when: whenLine(c, c.rs),
              caveats: [B("Skin under clear skies at ~10:30 against air at 2 m in all weather: agreement in sign is the test, not agreement in size. Two records over the same place are not independent samples, so their difference carries no p-value.",
                "Цэлмэг тэнгэрт ~10:30-д хэмжсэн гадаргуу ба бүх цаг агаарт 2 м-ийн агаар: тест нь хэмжээний биш, тэмдгийн тохироо. Нэг газрын хоёр бүртгэл бол хараат бус түүвэр биш тул зөрүүнд нь p-утга өгөхгүй."),
                B(`Terra's orbit drift since 2020 is tested as a step in every surface cell (${c.nf(c.k.step_flagged || 0)} flagged); MERRA-2's own stream boundaries (2001, 2011) fall inside these years.`,
                  `2020 оноос хойших Terra-гийн тойргийн шилжилтийг гадаргын нүд бүрт алхамаар шалгасан (${c.nf(c.k.step_flagged || 0)} тэмдэглэгдсэн); MERRA-2-ийн өөрийн урсгалын хил (2001, 2011) эдгээр жилүүдийн дотор байна.`)],
            };
          } },
      ],
    },
  ];

  // ------------------------------------------------------------ "your own case": a live NASA POWER scene as a case
  // Built at run time from a scene the live analysis produced; the same step vocabulary, so the engine needs nothing new.
  const dynamic = new Map();
  function template(sc) {
    const where = sc.region_name || "", name = `${sc.long_name || sc.var} (${sc.var})`;
    const srcEn = sc.kind === "mission" ? "CERES satellites" : "the MERRA-2 reanalysis", srcMn = sc.kind === "mission" ? "CERES хиймэл дагуул" : "MERRA-2 дахин шинжилгээ";
    const rmName = (c) => (c.sc.region_means && c.sc.region_means[0] ? c.A.regionName(c.sc.region_means[0]) : where);
    return {
      id: `own-${sc.id}`, tag: "global", own: true,
      title: B(`${name} · ${where}`, `${name} · ${where}`),
      question: B(`Your own case: ${sc.product_name || ""} read live from NASA POWER on AWS, every cell tested in your browser.`,
        `Таны өөрийн хэрэг: ${sc.product_name || ""} NASA POWER-оос AWS дээр шууд уншиж, нүд бүрийг таны хөтөч дээр шалгасан.`),
      steps: [
        { action: { scene: sc.id, view: "map", layer: "trend", zoom: "reset", sel: null },
          title: B("What the map shows", "Газрын зураг юу харуулж байна"),
          text: B(`Monthly values of ${name} from ${srcEn} for your box, read just now. Red or blue by the sign of the Sen slope; full colour where the cell's trend survives the false discovery rate test across the box; faded where it does not.`,
            `${srcMn}-ийн ${name}-ийн сарын утга, таны хайрцагт, дөнгөж уншсан. Sen-ий налуугийн тэмдгээр улаан эсвэл цэнхэр; нүдний чиг хайрцаг даяарх хуурамч нээлтийн хувийн тестийг давсан газарт тод, даваагүй газарт бүдэг.`),
          evidence: (c) => join(cellsLine(c), B(`${rmName(c)}: ${meanLine(c, c.rs, c.unit).en}`, `${rmName(c)}: ${meanLine(c, c.rs, c.unit).mn}`)) },
        { action: { layer: "verdict" },
          title: B("A verdict for every cell", "Нүд бүрт дүгнэлт"),
          text: B("Detected and confirmed by a second, parametric test; detected by one test only; not yet detectable with a record this short; excluded for missing months. “Not yet” is not “no change”.",
            "Илэрсэн бөгөөд хоёр дахь, параметрт тест баталсан; зөвхөн нэг тест илрүүлсэн; ийм богино бүртгэлээр хараахан илрэхгүй; сар дутуу тул хассан. «Хараахан биш» гэдэг нь «өөрчлөлтгүй» гэсэн үг биш."),
          evidence: (c) => B(`${c.nf(c.k.robust)} confirmed by both tests · ${c.nf(c.k.not_yet)} not yet detectable · ${c.nf(c.k.gappy || 0)} excluded`,
            `${c.nf(c.k.robust)} нүдийг хоёр тест баталсан · ${c.nf(c.k.not_yet)} хараахан илрэхгүй · ${c.nf(c.k.gappy || 0)} хассан`) },
        { action: { layer: "detect" },
          title: B("The smallest trend this record could detect", "Энэ бүртгэлийн илрүүлж чадах хамгийн бага чиг"),
          text: B("Given each cell's noise and month-to-month memory φ: the smallest trend detectable with 90 % power. Where the measured trend is below it, “not detected” is the expected outcome even if the trend is real.",
            "Нүд бүрийн шуугиан ба сар хоорондын санах ой φ-г тооцоход 90 %-ийн хүчээр илрүүлж чадах хамгийн бага чиг. Хэмжсэн чиг үүнээс бага газарт чиг бодит байсан ч «илрээгүй» гэсэн үр дүн хүлээгдэнэ."),
          evidence: (c) => B(`${rmName(c)}: measured ${c.signed(c.rs.sen)} vs smallest detectable ±${c.fmt(c.rs.mdt)} ${c.unit} per decade; φ = ${c.fmt(c.rs.phi, 2)}`,
            `${rmName(c)}: хэмжсэн ${c.signed(c.rs.sen)}, илрүүлж чадах хамгийн бага ±${c.fmt(c.rs.mdt)} ${c.unit} арван жилд; φ = ${c.fmt(c.rs.phi, 2)}`) },
        { action: { layer: "emerge" },
          title: B("The year it would show", "Харагдах он"),
          text: B("If the measured trend continues, the year it reaches 90 % detection probability (Weatherhead et al. 1998), with a range from the Sen confidence interval.",
            "Хэмжсэн чиг үргэлжилбэл 90 %-ийн илрэх магадлалд хүрэх он (Weatherhead нар, 1998), муж нь Sen-ий итгэлийн завсраас."),
          evidence: (c) => B(`${rmName(c)}: ${c.detectSentence(c.det(c.rs))}`, `${rmName(c)}: ${c.detectSentence(c.det(c.rs))}`) },
        { action: { layer: "trend" }, verdict: true,
          title: B("Verdict", "Дүгнэлт"),
          text: B("The four questions, answered for your variable and your box.", "Дөрвөн асуултад таны хувьсагч, таны хайрцгийн хувьд хариулав."),
          verdict: (c) => {
            const li = c.sc.live_info || {}, tr = c.sc.transitions || [];
            return {
              what: B(`${name} over ${where}: ${trendWord(c, c.rs).en}.`, `${where} дээрх ${name}: ${trendWord(c, c.rs).mn}.`),
              where: B(`${c.nf(c.k.fdr_up)} cells up and ${c.nf(c.k.fdr_down)} down after FDR, of ${c.nf(c.k.valid)}.`, `${c.nf(c.k.valid)} нүдний ${c.nf(c.k.fdr_up)} нь өсөж, ${c.nf(c.k.fdr_down)} нь буурч байна (FDR-ийн дараа).`),
              howmuch: B(`${rmName(c)} ${meanLine(c, c.rs, c.unit).en}.`, `${rmName(c)} ${meanLine(c, c.rs, c.unit).mn}.`),
              significant: B(`Corrected p ${c.fmtP(c.rs.p_mk)}; ${c.res.pstar > 0 ? `FDR threshold p* = ${c.fmt(c.res.pstar, 3)}` : "no cell passes the FDR test"}.`,
                `Засварласан p ${c.fmtP(c.rs.p_mk)}; ${c.res.pstar > 0 ? `FDR босго p* = ${c.fmt(c.res.pstar, 3)}` : "FDR тестийг нэг ч нүд давахгүй"}.`),
              when: whenLine(c, c.rs),
              caveats: [B(`Read live from NASA POWER on AWS (${li.mb || "?"} MB, ${li.chunks || "?"} chunks); nothing was uploaded.`, `NASA POWER-оос AWS дээр шууд уншсан (${li.mb || "?"} МБ, ${li.chunks || "?"} хэсэг); юу ч илгээгээгүй.`),
                ...tr.filter((x) => x.date && +x.date.slice(0, 4) >= c.st.y0 && +x.date.slice(0, 4) <= c.st.y1).map((x) => B(`Documented source change ${x.date || "?"}: ${x.label}${c.sc.steps && c.sc.steps.length ? " (tested as a step)" : " (not tested as a step in live mode; look at the series around that date)"}.`,
                  `Баримтжуулсан эх сурвалжийн шилжилт ${x.date || "?"}: ${x.label}${c.sc.steps && c.sc.steps.length ? " (алхам байдлаар шалгасан)" : " (шууд горимд алхамаар шалгаагүй; тэр огнооны орчим цувааг харна уу)"}.`)),
                sc.kind === "mission"
                  ? B("CERES satellite products merge several instruments whose make-up changes over time.", "CERES хиймэл дагуулын бүтээгдэхүүн бүрэлдэхүүн нь цаг хугацааны явцад өөрчлөгддөг хэд хэдэн багажийг нэгтгэдэг.")
                  : B("MERRA-2 is a reanalysis: a model constrained by observations, not a station network.", "MERRA-2 бол дахин шинжилгээ: ажиглалтаар хязгаарласан загвар, станцын сүлжээ биш.")],
            };
          } },
      ],
    };
  }
  // open a live scene as a case (called by the workbench when the live analysis was started from the case board)
  function openOwn(sc) {
    const c = template(sc);
    dynamic.set(c.id, c);
    return open(c.id);
  }

  // ------------------------------------------------------------ pure API (node-testable)
  // the cases whose required scenes are in the index (all of them when no index is given)
  const avail = (ids) => (ids ? CASES.filter((c) => !c.requires || c.requires.every((r) => ids.includes(r))) : CASES);
  const list = (ids) => avail(ids).map((c) => ({ id: c.id, tag: c.tag, title: c.title, question: c.question, steps: c.steps.length, requires: c.requires || null }));
  const get = (id) => CASES.find((c) => c.id === id) || dynamic.get(id) || null;
  // problems with the definitions against a scene index and place list: [] when all is well
  function check(sceneIds, placeNames) {
    const out = [], ids = new Set();
    const text = (o, where) => { if (!o || typeof o.en !== "string" || typeof o.mn !== "string" || !o.en.trim() || !o.mn.trim()) out.push(`${where}: needs en and mn text`); };
    for (const c of CASES) {
      if (!/^[a-z][a-z0-9-]*$/.test(c.id)) out.push(`${c.id}: bad id`);
      if (ids.has(c.id)) out.push(`${c.id}: duplicate id`); ids.add(c.id);
      if (!TAGS.includes(c.tag)) out.push(`${c.id}: unknown tag ${c.tag}`);
      if (c.requires !== undefined && !(Array.isArray(c.requires) && c.requires.length && c.requires.every((r) => /^[a-z][a-z0-9-]*$/.test(r)))) out.push(`${c.id}: bad requires`);
      const known = (id) => sceneIds.includes(id) || (c.requires || []).includes(id);
      text(c.title, c.id + ".title"); text(c.question, c.id + ".question");
      if (!Array.isArray(c.steps) || c.steps.length < 3) out.push(`${c.id}: needs at least 3 steps`);
      c.steps.forEach((s, k) => {
        const w = `${c.id}[${k}]`, a = s.action || {};
        text(s.title, w + ".title"); text(s.text, w + ".text");
        for (const key of Object.keys(a)) if (!ACTION_KEYS.includes(key)) out.push(`${w}: unknown action ${key}`);
        if (a.scene && !known(a.scene)) out.push(`${w}: unknown scene ${a.scene}`);
        if (a.compare && typeof a.compare === "object" && (!known(a.compare.id) || !(a.compare.y1 - a.compare.y0 >= 9))) out.push(`${w}: bad compare`);
        if (a.risk && (!["fire", "dust"].includes(a.risk.type) || !/^\d{4}-\d{2}-\d{2}$/.test(a.risk.date))) out.push(`${w}: bad risk action`);
        if (a.layer && !LAYERS.includes(a.layer)) out.push(`${w}: unknown layer ${a.layer}`);
        if (a.season && !SEASONS.includes(a.season)) out.push(`${w}: unknown season ${a.season}`);
        if (a.tab && !TABS.includes(a.tab)) out.push(`${w}: unknown tab ${a.tab}`);
        if (a.view && !["map", "surf"].includes(a.view)) out.push(`${w}: unknown view ${a.view}`);
        if (a.place && !placeNames.includes(a.place)) out.push(`${w}: unknown place ${a.place}`);
        if (a.years && a.years !== "full" && !(Array.isArray(a.years) && a.years.length === 2 && a.years[1] - a.years[0] >= 9)) out.push(`${w}: bad years`);
        if (a.box && !(Array.isArray(a.box) && a.box.length === 4 && a.box[0] < a.box[2] && a.box[1] < a.box[3])) out.push(`${w}: bad box`);
        if (a.zoom && a.zoom !== "reset" && !(Number.isFinite(a.zoom.lon) && Number.isFinite(a.zoom.lat) && a.zoom.z > 0)) out.push(`${w}: bad zoom`);
        if (k === 0 && !a.scene && !a.risk) out.push(`${w}: the first step must name a scene or a risk map`);
        if (s.verdict && typeof s.verdict !== "function" && k !== c.steps.length - 1) out.push(`${w}: verdict must be the last step`);
        if (k === c.steps.length - 1 && typeof s.verdict !== "function") out.push(`${w}: the last step needs a verdict function`);
        if (k < c.steps.length - 1 && typeof s.evidence !== "function") out.push(`${w}: needs an evidence function`);
      });
    }
    return out;
  }

  // ------------------------------------------------------------ engine (browser only)
  let cur = null, token = 0, busy = false;
  const A = () => root.TDApp, I = () => root.TDI18N, $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const lang = () => I().lang();
  const indexIds = () => (A() && A().state.index ? A().state.index.scenes.map((s) => s.id) : null);
  const tx = (o) => (o ? (o[lang()] || o.en || "") : "");
  const t = (k, v) => I().t(k, v);

  // everything an evidence or verdict function may read, built from the live results
  function context() {
    const a = A(), st = a.state, sc = st.sc, res = st.res;
    const k = res ? res.counts : {};
    const rsBy = (key) => { const i = sc.region_means ? sc.region_means.findIndex((r) => r.key === key) : -1; return i >= 0 ? a.regionStats(i) : null; };
    const risk = a.isRisk() && !sc.unavailable ? { scene: sc.metadata && sc.metadata.LANDSAT_PRODUCT_ID || sc.source || "", cloud: sc.metadata ? sc.metadata.CLOUD_COVER : NaN,
      n: k.valid, when: String(sc.acquired_utc || sc.period.start).slice(0, 16).replace("T", " ") } : null;
    return { A: a, st, sc, res, k, alpha: st.alpha, rs: a.regionStats(0), rsBy, sel: a.selStats(), risk,
      zone: sc && sc.clim12 && res ? a.zoneInfo() : null, ref: sc && sc.reference, truth: sc && sc.truth ? sc.truth.scores : null,
      truthCells: sc && sc.truth ? sc.truth.slope.filter((v) => v).length : 0,
      comparison: (id) => (st.index.comparisons || []).find((p) => p.a === id || p.b === id) || null,
      unit: sc ? a.unitLabel(sc.units) : "", yrs: sc && !a.isRisk() ? a.yrsText() : "",
      det: (s) => (s ? a.detectYear(s.nstar, s.sen, s.sen_lo, s.sen_hi, s.phi, s.n) : null),
      fmt: a.fmt, signed: a.signed, fmtP: a.fmtP, nf: a.nf, detectShort: a.detectShort, detectSentence: a.detectSentence, stepOf: a.stepOf };
  }
  const safe = (fn, ctx) => { try { return fn(ctx); } catch (e) { return null; } };

  // the dataset a step runs on: its own, else the nearest earlier step's
  function anchor(c, k) {
    for (let i = k; i >= 0; i--) { const a = c.steps[i].action || {}; if (a.risk) return { risk: a.risk }; if (a.scene) return { scene: a.scene }; }
    return {};
  }
  async function apply(action) {
    const a = A(), st = a.state;
    if (action.risk) { const r = action.risk; if (!st.sc || st.sc.id !== `${r.type}-risk` || st.sc.period.start !== r.date) await a.openRisk(r.type, r.date); }
    else if (action.scene && (!st.sc || st.sc.id !== action.scene)) await a.showScene(action.scene);
    if (!a.isRisk() && st.sc) {
      await a.configure({ years: action.years || (action.scene ? "full" : undefined), season: action.season !== undefined ? action.season : (action.scene ? "all" : undefined), alpha: action.alpha });
      // an explicit compare side is loaded as given (the default would split the years in two halves)
      if (action.compare && typeof action.compare === "object") { a.cmp.on = true; a.cmp.prev = null; await a.cmpLoad(action.compare.id, action.compare.y0, action.compare.y1); }
      else if (action.compare !== undefined && !!action.compare !== a.cmp.on) await a.setCompare(!!action.compare);
      else if (action.scene && action.compare === undefined && a.cmp.on) await a.setCompare(false);   // a step that opens a scene starts without a split
      if (action.layer && a.availLayers().includes(action.layer)) a.setLayer(action.layer);
    }
    if (action.view) a.setView(action.view);
    if (action.sel === null) a.clearSel();
    if (action.zoom === "reset") a.resetView(); else if (action.zoom) a.zoomTo(action.zoom.lon, action.zoom.lat, action.zoom.z);
    if (!a.isRisk() && st.res) {
      if (action.place) a.selectPlace(action.place, action.zoom && action.zoom.z);
      if (action.box) a.selectBox(action.box);
    }
    a.renderAll();
    if (action.tab && action.tab !== "map") a.setTab(action.tab);
  }

  function setHash() {
    if (!cur) return;
    try { history.replaceState(null, "", `#case/${cur.id}/${cur.step + 1}`); } catch (e) { /* file:// can refuse */ }
  }
  async function open(id, step = 0) {
    const c = get(id);
    if (!c || !A() || !A().state.index) return;
    if (c.requires && !avail(indexIds()).includes(c)) { board(); return; }   // its scenes are not built on this site
    const my = ++token;
    cur = { id, step: Math.max(0, Math.min(c.steps.length - 1, step)) };
    A().closeModal();
    busy = true; render();
    try { await apply(Object.assign({}, anchor(c, cur.step), c.steps[cur.step].action || {})); } finally { if (my === token) { busy = false; } }
    if (my !== token) return;
    setHash(); render();
    const bar = $("#casebar"); if (bar) bar.scrollIntoView({ block: "nearest" });
  }
  const openHash = (h) => { const [, id, n] = h.split("/"); return open(id, n ? +n - 1 : 0); };
  const current = () => (cur ? cur.id : null);
  const next = () => cur && open(cur.id, cur.step + 1);
  const prev = () => cur && open(cur.id, cur.step - 1);
  function close() {
    cur = null; ++token; busy = false; render();
    const sc = A().state.sc;
    try { history.replaceState(null, "", sc ? "#" + (A().isRisk() ? `risk/${sc.kind.replace("-risk", "")}/${sc.period.start}` : sc.id) : " "); } catch (e) { /* file:// */ }
  }
  function board() {
    const cases = avail(indexIds()), hidden = CASES.length - cases.length;
    const cards = cases.map((c) => `<button type="button" class="casecard" data-case="${c.id}"><span class="tag">${esc(t("cases_tag_" + c.tag))}</span><b>${esc(tx(c.title))}</b><span>${esc(tx(c.question))}</span><small>${esc(t("cases_steps", { n: c.steps.length }))}</small></button>`).join("")
      + `<button type="button" class="casecard own" data-case-nav="own"><span class="tag">${esc(t("cases_tag_own"))}</span><b>${esc(t("cases_own"))}</b><span>${esc(t("cases_own_q"))}</span><small>${esc(t("cases_steps", { n: 5 }))}</small></button>`;
    A().modal(`<h2>${esc(t("cases_title"))}</h2><p class="muted">${esc(t("cases_intro"))}</p><div class="caseboard">${cards}</div>
      ${hidden ? `<p class="small muted">${esc(t("cases_more", { n: hidden }))}</p>` : ""}
      <p class="small muted">${esc(t("cases_or"))} <button type="button" class="linkbtn" data-case-nav="guide">${esc(t("cases_guide"))}</button></p>`);
    $("#modalbox").classList.add("wide");
    $("#modalclose").textContent = t("cases_workbench");
  }
  // ---- the verdict as a 1200 × 630 image (for the project page, a post, a slide)
  function cardPng() {
    const c = get(cur.id), s = c.steps[cur.step], a = A();
    if (!s.verdict || !a.state.res) return;
    const v = safe(s.verdict, context()) || {}, W = 1200, H = 630, cv = document.createElement("canvas");
    cv.width = W * 2; cv.height = H * 2;
    const g = cv.getContext("2d"); g.scale(2, 2);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.fillStyle = "#000"; g.fillRect(0, 0, W, 8);
    const sans = '"IBM Plex Sans", system-ui, sans-serif', disp = '"Archivo", "Arial Narrow", system-ui, sans-serif', mono = '"IBM Plex Mono", ui-monospace, monospace';
    const wrap = (text, x, y, maxW, lh, font, color = "#000", maxLines = 99) => {
      g.font = font; g.fillStyle = color;
      const words = String(text).split(/\s+/); let line = "", yy = y, lines = 0;
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (g.measureText(test).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += lh; if (++lines >= maxLines) { line = ""; break; } } else line = test;
      }
      if (line) { g.fillText(line, x, yy); yy += lh; }
      return yy;
    };
    g.font = `600 13px ${sans}`; g.fillStyle = "#6a6a6a"; g.fillText(`TREND DETECTIVE · ${t("cases_title").toUpperCase()} · ${t("cases_verdict").toUpperCase()}`, 48, 44);
    let y = wrap(tx(c.title), 48, 84, W - 96, 36, `800 30px ${disp}`, "#000", 2);
    y = wrap(tx(c.question), 48, y + 4, W - 96, 21, `400 15px ${sans}`, "#333", 2) + 10;
    g.fillStyle = "#000"; g.fillRect(48, y, W - 96, 1); y += 18;
    for (const [k, val] of [["what", v.what], ["where", v.where], ["howmuch", v.howmuch], ["sig", v.significant], ["when", v.when]]) {
      if (!val || y > H - 110) continue;
      g.font = `600 14px ${sans}`; g.fillStyle = "#000"; g.fillText(t("cases_" + k), 48, y);
      y = Math.max(y + 19, wrap(tx(val), 230, y, W - 278, 19, `400 14px ${sans}`, "#000", 3)) + 6;
    }
    if (v.caveats && v.caveats.length && y < H - 90) {
      g.font = `600 11px ${sans}`; g.fillStyle = "#6a6a6a"; g.fillText(t("cases_caveats").toUpperCase(), 48, y + 6); y += 24;
      for (const x of v.caveats.slice(0, 2)) { if (y > H - 70) break; y = wrap("· " + tx(x), 48, y, W - 96, 16, `400 12px ${sans}`, "#333", 2) + 2; }
    }
    const sc = a.state.sc, foot = `${a.sceneTitle(sc)}${a.isRisk() ? "" : " · " + a.yrsText()} · ${location.href.split("#")[0]}#case/${c.id}/${cur.step + 1}`;
    g.fillStyle = "#000"; g.fillRect(48, H - 44, W - 96, 1);
    g.font = `400 11px ${mono}`; g.fillStyle = "#6a6a6a"; g.fillText(foot.slice(0, 150), 48, H - 24);
    cv.toBlob((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = `trend-detective-${c.id}.png`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }, "image/png");
  }
  function render() {
    const el = $("#casebar"); if (!el) return;
    if (!cur) { el.hidden = true; el.innerHTML = ""; return; }
    const c = get(cur.id), n = c.steps.length, s = c.steps[cur.step], a = A(), st = a.state, last = cur.step === n - 1;
    const ctx = st.sc && st.res ? context() : null;
    const an = anchor(c, cur.step), expected = an.risk ? `${an.risk.type}-risk` : an.scene || null;
    const away = !busy && expected && st.sc && st.sc.id !== expected;
    const dots = c.steps.map((_, k) => `<i class="${k === cur.step ? "on" : k < cur.step ? "done" : ""}"></i>`).join("");
    let body;
    if (busy) body = `<p class="muted">${esc(t("computing", { p: "" })).replace(/\s*\(\s*%\)?/, "")}</p>`;
    else if (last && ctx) {
      const v = safe(s.verdict, ctx) || {};
      const row = (k, val) => (val ? `<dt>${esc(t("cases_" + k))}</dt><dd>${esc(tx(val))}</dd>` : "");
      body = `<p>${esc(tx(s.text))}</p><dl class="kv verdict">${row("what", v.what)}${row("where", v.where)}${row("howmuch", v.howmuch)}${row("sig", v.significant)}${row("when", v.when)}</dl>
        ${v.caveats && v.caveats.length ? `<p class="eyebrow">${esc(t("cases_caveats"))}</p><ul>${v.caveats.map((x) => `<li>${esc(tx(x))}</li>`).join("")}</ul>` : ""}`;
    } else {
      const ev = ctx && s.evidence ? safe(s.evidence, ctx) : null;
      body = `<p>${esc(tx(s.text))}</p>${ev && tx(ev) ? `<p class="evidence"><b>${esc(t("cases_evidence"))}:</b> ${esc(tx(ev))}</p>` : ""}`;
    }
    const cs = avail(indexIds()), k = cs.indexOf(c), nextCase = cs[(k + 1) % cs.length] || c, url = location.href.split("#")[0] + `#case/${cur.id}/${cur.step + 1}`;
    const qr = qrOpen && !c.own && root.TDQR ? `<div class="qr">${root.TDQR.svg(url, 3, 2)}<span class="small muted">${esc(t("cases_qr_hint"))}</span></div>` : "";
    el.innerHTML = `<div class="casehead"><span class="eyebrow">${esc(t("cases_step", { n: cur.step + 1, m: n }))}</span><b>${esc(tx(c.title))}</b><span class="dots" aria-hidden="true">${dots}</span>
        <button type="button" class="btn" data-case-nav="exit" aria-label="${esc(t("cases_exit"))}">✕ ${esc(t("cases_exit"))}</button></div>
      <div class="casebody"><h3>${esc(tx(s.title))}</h3>${away ? `<p class="warn"><span class="icon" aria-hidden="true">!</span><span>${esc(t("cases_left"))} <button type="button" class="linkbtn" data-case-nav="resume">${esc(t("cases_resume"))}</button></span></p>` : ""}${body}</div>
      <div class="casenav"><button type="button" class="btn" data-case-nav="prev" ${cur.step === 0 || busy ? "disabled" : ""}>‹ ${esc(t("cases_prev"))}</button>
        ${last ? `<button type="button" class="btn primary" data-case="${nextCase.id}" ${busy ? "disabled" : ""}>${esc(t("cases_nextcase"))}: ${esc(tx(nextCase.title))} ›</button><button type="button" class="btn" data-case-nav="board">${esc(t("cases_done"))}</button><button type="button" class="btn" data-case-nav="png" ${busy ? "disabled" : ""}>${esc(t("cases_png"))}</button>`
          : `<button type="button" class="btn primary" data-case-nav="next" ${busy ? "disabled" : ""}>${esc(t("cases_next"))} ›</button>`}
        ${c.own ? "" : `<button type="button" class="btn" data-case-nav="link">${esc(t("cases_link"))}</button><button type="button" class="btn" data-case-nav="qr" aria-pressed="${qrOpen}">${esc(t("cases_qr"))}</button>`}<span class="small muted" id="caselinknote"></span></div>${qr}`;
    el.hidden = false;
  }
  let qrOpen = false;
  // re-render against the current state (called by the workbench after every renderAll)
  const sync = () => { if (cur) render(); };
  async function copyLink() {
    const url = location.href.split("#")[0] + `#case/${cur.id}/${cur.step + 1}`, note = $("#caselinknote");
    try { await navigator.clipboard.writeText(url); if (note) note.textContent = t("cases_copied"); }
    catch (e) { if (note) note.textContent = url; }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const card = e.target.closest("[data-case]");
      if (card) { open(card.dataset.case); return; }
      if (e.target.closest("#casesbtn")) { board(); return; }
      const nav = e.target.closest("[data-case-nav]");
      if (!nav) return;
      const what = nav.dataset.caseNav;
      if (what === "next") next(); else if (what === "prev") prev(); else if (what === "exit") close();
      else if (what === "resume" && cur) open(cur.id, cur.step); else if (what === "link") copyLink();
      else if (what === "qr") { qrOpen = !qrOpen; render(); }
      else if (what === "png") cardPng();
      else if (what === "own") { A().closeModal(); A().openLive(true); }
      else if (what === "board") { close(); board(); }
      else if (what === "guide") { A().closeModal(); A().modal(`<h2>${esc(t("guide_title"))}</h2><ol>${t("guide").map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`); }
    });
  }

  root.TDCases = { list, avail, get, check, template, openOwn, current, open, openHash, next, prev, close, board, sync, ACTION_KEYS, LAYERS, SEASONS, TAGS };
})(typeof window === "undefined" ? globalThis : window);
