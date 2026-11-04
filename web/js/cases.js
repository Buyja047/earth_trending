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
  const LAYERS = ["trend", "naive", "verdict", "detect", "emerge", "zone", "anom", "steps", "truth"];
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
  ];

  // ------------------------------------------------------------ pure API (node-testable)
  const list = () => CASES.map((c) => ({ id: c.id, tag: c.tag, title: c.title, question: c.question, steps: c.steps.length }));
  const get = (id) => CASES.find((c) => c.id === id) || null;
  // problems with the definitions against a scene index and place list: [] when all is well
  function check(sceneIds, placeNames) {
    const out = [], ids = new Set();
    const text = (o, where) => { if (!o || typeof o.en !== "string" || typeof o.mn !== "string" || !o.en.trim() || !o.mn.trim()) out.push(`${where}: needs en and mn text`); };
    for (const c of CASES) {
      if (!/^[a-z][a-z0-9-]*$/.test(c.id)) out.push(`${c.id}: bad id`);
      if (ids.has(c.id)) out.push(`${c.id}: duplicate id`); ids.add(c.id);
      if (!TAGS.includes(c.tag)) out.push(`${c.id}: unknown tag ${c.tag}`);
      text(c.title, c.id + ".title"); text(c.question, c.id + ".question");
      if (!Array.isArray(c.steps) || c.steps.length < 3) out.push(`${c.id}: needs at least 3 steps`);
      c.steps.forEach((s, k) => {
        const w = `${c.id}[${k}]`, a = s.action || {};
        text(s.title, w + ".title"); text(s.text, w + ".text");
        for (const key of Object.keys(a)) if (!ACTION_KEYS.includes(key)) out.push(`${w}: unknown action ${key}`);
        if (a.scene && !sceneIds.includes(a.scene)) out.push(`${w}: unknown scene ${a.scene}`);
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
      if (action.compare !== undefined && !!action.compare !== a.cmp.on) await a.setCompare(!!action.compare);
      if (action.compare && typeof action.compare === "object") await a.cmpLoad(action.compare.id, action.compare.y0, action.compare.y1);
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
    const l = lang(), cards = CASES.map((c) => `<button type="button" class="casecard" data-case="${c.id}"><span class="tag">${esc(t("cases_tag_" + c.tag))}</span><b>${esc(tx(c.title))}</b><span>${esc(tx(c.question))}</span><small>${esc(t("cases_steps", { n: c.steps.length }))}</small></button>`).join("");
    A().modal(`<h2>${esc(t("cases_title"))}</h2><p class="muted">${esc(t("cases_intro"))}</p><div class="caseboard">${cards}</div>
      <p class="small muted">${esc(t("cases_or"))} <button type="button" class="linkbtn" data-case-nav="guide">${esc(t("cases_guide"))}</button></p>`);
    $("#modalbox").classList.add("wide");
    $("#modalclose").textContent = t("cases_workbench");
    void l;
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
    const k = CASES.indexOf(c), nextCase = CASES[(k + 1) % CASES.length];
    el.innerHTML = `<div class="casehead"><span class="eyebrow">${esc(t("cases_step", { n: cur.step + 1, m: n }))}</span><b>${esc(tx(c.title))}</b><span class="dots" aria-hidden="true">${dots}</span>
        <button type="button" class="btn" data-case-nav="exit" aria-label="${esc(t("cases_exit"))}">✕ ${esc(t("cases_exit"))}</button></div>
      <div class="casebody"><h3>${esc(tx(s.title))}</h3>${away ? `<p class="warn"><span class="icon" aria-hidden="true">!</span><span>${esc(t("cases_left"))} <button type="button" class="linkbtn" data-case-nav="resume">${esc(t("cases_resume"))}</button></span></p>` : ""}${body}</div>
      <div class="casenav"><button type="button" class="btn" data-case-nav="prev" ${cur.step === 0 || busy ? "disabled" : ""}>‹ ${esc(t("cases_prev"))}</button>
        ${last ? `<button type="button" class="btn primary" data-case="${nextCase.id}" ${busy ? "disabled" : ""}>${esc(t("cases_nextcase"))}: ${esc(tx(nextCase.title))} ›</button><button type="button" class="btn" data-case-nav="board">${esc(t("cases_done"))}</button>`
          : `<button type="button" class="btn primary" data-case-nav="next" ${busy ? "disabled" : ""}>${esc(t("cases_next"))} ›</button>`}
        <button type="button" class="btn" data-case-nav="link">${esc(t("cases_link"))}</button><span class="small muted" id="caselinknote"></span></div>`;
    el.hidden = false;
  }
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
      else if (what === "board") { close(); board(); }
      else if (what === "guide") { A().closeModal(); A().modal(`<h2>${esc(t("guide_title"))}</h2><ol>${t("guide").map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`); }
    });
  }

  root.TDCases = { list, get, check, current, open, openHash, next, prev, close, board, sync, ACTION_KEYS, LAYERS, SEASONS, TAGS };
})(typeof window === "undefined" ? globalThis : window);
