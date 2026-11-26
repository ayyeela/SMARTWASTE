// URL model Teachable Machine (bisa ditimpa sementara lewat ?model=URL di alamat halaman)
const MODEL_URL = "https://teachablemachine.withgoogle.com/models/2zIpLkkjb/";
const H = 30;                       // tinggi tempat sampah (cm), sama dengan pipeline.py
const BINS = ["organik", "anorganik", "residu"];
const COLOR = {organik:"--organik", anorganik:"--anorganik", residu:"--residu"};
const TO_BIN = {organik:"organik", anorganik:"anorganik", residu:"residu"};
const RATE = {organik:2.2, anorganik:1.6, residu:1.1};   // %/jam untuk simulasi
const state = {};
BINS.forEach((b,i)=> state[b] = {fill:[55,35,20][i], hist:[], urgensi:"Aman", jam:99, rate:0});

const $ = s => document.querySelector(s);
$("#acc").textContent = (TREE.accuracy*100).toFixed(1) + "%";

// --- model: telusuri Decision Tree hasil pelatihan ---
function predict(x){
  let n = 0;
  while (TREE.left[n] !== -1)
    n = x[TREE.features[TREE.feature[n]]] <= TREE.threshold[n] ? TREE.left[n] : TREE.right[n];
  return TREE.labels[TREE.value[n]];
}

// --- UI ---
const binsEl = $("#bins");
BINS.forEach(b => binsEl.insertAdjacentHTML("beforeend", `
  <article class="bin" style="--c:var(${COLOR[b]})" id="bin-${b}">
    <h3 class="tag">${b}</h3>
    <div class="body">
      <div class="bag"><div class="tank" role="img" aria-label="Level ${b}"><div class="fill"></div></div></div>
      <div class="info">
        <div class="pct"><span class="v">0</span><small>%</small></div>
        <div class="mid"><p class="meta"></p><span class="badge">Aman</span></div>
        <button data-empty="${b}">kosongkan</button>
      </div>
    </div>
  </article>`));

function log(msg){
  const li = document.createElement("li");
  li.innerHTML = `<time>${new Date().toLocaleTimeString("id-ID")}</time><span>${msg}</span>`;
  $("#log").prepend(li);
  while ($("#log").children.length > 40) $("#log").lastChild.remove();
}

function update(b){
  const s = state[b], h = s.hist;
  h.push(s.fill); if (h.length > 7) h.shift();
  s.rate = h.length > 6 ? Math.max(0, s.fill - h[0]) : 0;           // %/jam (6 tick = 1 jam simulasi)
  s.jam = s.rate > .05 ? Math.min(99, (100 - s.fill) / s.rate) : 99;
  const prev = s.urgensi;
  s.urgensi = predict({kapasitas_pct:s.fill, laju_pct_jam:s.rate, est_jam_penuh:s.jam});
  if (prev !== s.urgensi && s.urgensi === "Angkut") log(`Tempat sampah <b>${b}</b> perlu diangkut (${s.fill.toFixed(0)}%).`);
  const el = $("#bin-"+b);
  el.querySelector(".fill").style.height = s.fill + "%";
  el.querySelector(".v").textContent = s.fill.toFixed(0);
  el.querySelector(".meta").textContent = s.jam < 99 ? `Penuh ±${s.jam.toFixed(0)} jam` : "Laju isi rendah";
  const bd = el.querySelector(".badge"); bd.textContent = s.urgensi; bd.className = "badge " + s.urgensi;
}
function refresh(){
  BINS.forEach(update);
  const need = BINS.filter(b => state[b].urgensi === "Angkut");
  const a = $("#alert"); a.hidden = !need.length;
  a.textContent = need.length ? "Perlu diangkut: " + need.join(", ") : "";
}

// --- sampah teridentifikasi -> masuk tempat sampah ---
function register(kind, source){
  const b = TO_BIN[kind]; if (!b) return;
  state[b].fill = Math.min(100, state[b].fill + 4);
  $("#last").textContent = `Terdeteksi: ${kind}, masuk ke tempat sampah ${b}.`;
  log(`${source}: <b>${kind}</b> → ${b}`);
  refresh();
}
document.querySelectorAll(".tests button").forEach(btn => btn.onclick = () => register(btn.dataset.k, "Uji manual"));
document.addEventListener("click", e => {
  const b = e.target.dataset && e.target.dataset.empty;
  if (b){ state[b].fill = 3; state[b].hist = []; log(`Tempat sampah <b>${b}</b> dikosongkan petugas.`); refresh(); }
});

// --- sumber data sensor ---
let timer;
function startSource(){
  clearInterval(timer);
  const esp = $("#mode").value === "esp";
  $("#espUrl").hidden = !esp;
  timer = setInterval(async () => {
    if (!esp){
      BINS.forEach(b => state[b].fill = Math.min(100, state[b].fill + Math.max(0, RATE[b] + (Math.random()-.5)*1.6)/6));
      return refresh();
    }
    const url = $("#espUrl").value; if (!url) return;
    try{                                // ESP32 mengirim {"organik":12.3,"anorganik":20.1,"residu":25.0} (jarak cm)
      const d = await (await fetch(url)).json();
      BINS.forEach(b => { if (typeof d[b] === "number") state[b].fill = Math.min(100, Math.max(0, (H - d[b]) / H * 100)); });
      refresh();
    }catch(err){ log("Gagal membaca ESP32: " + err.message); }
  }, esp ? 3000 : 1500);
}
$("#mode").onchange = startSource;

// --- Teachable Machine (kamera) ---
function loadScript(src){ return new Promise((ok,no)=>{ const s=document.createElement("script"); s.src=src; s.onload=ok; s.onerror=()=>no(new Error("tidak bisa memuat " + src)); document.head.append(s); }); }
async function loadLib(lokal, cdn){ try{ await loadScript(lokal); }catch(e){ await loadScript(cdn); } }   // utamakan file lokal di lib/, cadangan lewat CDN
$("#tmStart").onclick = async () => {
  let url = (new URLSearchParams(location.search).get("model") || MODEL_URL).trim();
  if (!url.endsWith("/")) url += "/";
  try{
    $("#camHint").textContent = "Memuat model...";
    await loadLib("lib/tf.min.js", "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js");
    await loadLib("lib/teachablemachine-image.min.js", "https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js");
    const model = await tmImage.load(url + "model.json", url + "metadata.json");
    const cam = new tmImage.Webcam(260, 200, true); await cam.setup(); await cam.play();
    const box = $(".cam"); box.innerHTML = ""; box.append(cam.canvas);
    let streak = {k:null, n:0}, armed = true, idle = 0;
    (async function loop(){
      cam.update();
      const p = (await model.predict(cam.canvas)).sort((a,b)=>b.probability-a.probability)[0];
      const k = p.className.toLowerCase().trim(), sampah = k in TO_BIN, yakin = p.probability > .9;
      $("#live").textContent = sampah ? `Kamera: ${k} ${(p.probability*100).toFixed(0)}%` : "Kamera: tidak ada sampah";
      if (sampah && yakin){
        streak = (k === streak.k) ? {k, n:streak.n+1} : {k, n:1}; idle = 0;
        if (streak.n >= 6 && armed){ register(k, "Kamera"); armed = false; }   // stabil ~6 frame, dihitung sekali
      } else {
        streak = {k:null, n:0};
        if (++idle >= 15) armed = true;   // sampah sudah disingkirkan -> siap menghitung sampah berikutnya
      }
      requestAnimationFrame(loop);
    })();
  }catch(err){ $("#camHint").textContent = "Gagal: " + ((err && err.message) || err) + ". Periksa URL model dan izin kamera (butuh HTTPS atau localhost)."; }
};

BINS.forEach(b => { const s = state[b]; s.hist = Array(7).fill(0).map((_, i) => s.fill - (6 - i) * RATE[b] / 6); });
startSource(); refresh();