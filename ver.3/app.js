// ========== 定数・ヘルパー ==========

// 装備スロット一覧
const ALL_SLOTS = [
  "武器","頭","胴体","腕","足","首飾り",
  "指輪1","指輪2","イヤリング1","イヤリング2","腕輪","かばん","盾"
];

const RARITY_ALIAS = {
  "uncommon": "UNC",
  "rare": "RARE",
  "legendary": "LEG"
};

const RARITY_LABEL_JP = {
  "uncommon": "アンコモン",
  "rare": "レア",
  "legendary": "レジェンダリー"
};

function escapeHtml(s){
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

// 「率」「倍率」を含むステは % 扱い
function isPercentStat(statName){
  return statName.includes("率") || statName.includes("倍率");
}

// スロット行から「武器」「頭」などの名前を取得
function slotNameFromRow(row){
  if (!row) return "";
  const labelEl = row.querySelector(".slot-label");
  return labelEl ? labelEl.textContent.trim() : "";
}

// ========== マスターデータを使いやすく整形 ==========

const STAT_MAP = {};
STAT_MASTER.forEach(row=>{
  const name = row["正式名称"];
  const ui = row["UI略称"];
  const tip = row["ツールチップ（hoverで表示）"];
  const values = {};

  Object.entries(row).forEach(([k,v])=>{
    if (k.startsWith("lv")){
      // "lv.60" / "lv75" → "60" / "75"
      const lv = k.replace("lv.","").replace("lv","");
      values[lv] = v;
    }
  });

  STAT_MAP[name] = { ui, tip, values };
});

const POWER_STONES = {};
POWER_STONE_MASTER.forEach(row=>{
  const name = row["パワーストーン"];
  const ui = row["UI略称"];
  const tip = row["ツールチップ（hoverで表示）"];
  const values = {};

  Object.entries(row).forEach(([k,v])=>{
    if (k.startsWith("lv")){
      const lv = k.replace("lv.","").replace("lv","");
      values[lv] = v;
    }
  });

  POWER_STONES[name] = { ui, tip, values };
});

const TALISMANS = {};
TALISMAN_MASTER.forEach(row=>{
  const nameJP = row["Talisman"];
  const nameEN = row["Talisman_en"];
  const obj = { nameJP, nameEN, sets: {} };

  Object.entries(row).forEach(([key,val])=>{
    if (!val) return;
    if (key === "Talisman" || key === "Talisman_en") return;

    // 例: "legendary;set4-1"
    const [rarity, rest] = key.split(";");
    if (!rest) return;
    const setKey = rest.split("-")[0]; // "set2","set3","set4"

    obj.sets[rarity] = obj.sets[rarity] || {};
    obj.sets[rarity][setKey] = obj.sets[rarity][setKey] || [];
    obj.sets[rarity][setKey].push(val); // ステ名(例: "物理攻撃力")
  });

  TALISMANS[nameJP] = obj;
});

// ========== DOM 取得 ==========

const slotArea        = document.getElementById("slotArea");
const totalArea       = document.getElementById("totalArea");
const talismanDetail  = document.getElementById("talismanDetail");
const stoneDetail     = document.getElementById("stoneDetail");
const effectTableArea = document.getElementById("effectTableArea");
const levelSelect     = document.getElementById("levelSelect");
const useShieldCheck  = document.getElementById("useShield");

let currentSlots = [...ALL_SLOTS];

// 「武器ストーン自動コピー」をもうやったかフラグ
let initialWeaponStoneSyncDone = false;

// ========== スロットUI生成 ==========

function buildSlots(){
  slotArea.innerHTML = "";
  initialWeaponStoneSyncDone = false; // 作り直したらまた最初から

  currentSlots.forEach(slotName=>{
    const row = document.createElement("div");
    row.className = "slot-row";

    row.innerHTML = `
      <!-- ◆ 1段目：タリスマン + レアリティ -->
      <div class="slot-top">
        <div class="slot-label">${escapeHtml(slotName)}</div>

        <select class="talisman-select">
          <option value="">タリスマン選択</option>
          ${Object.keys(TALISMANS)
            .map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
            .join("")}
        </select>

        <select class="rarity-select">
          <option value="legendary">LEG</option>
          <option value="rare">RARE</option>
          <option value="uncommon">UNC</option>
        </select>
      </div>

      <!-- ◆ 2段目：パワーストーン（3枠） -->
      <div class="slot-bottom">
      <div class="slot-bottom-spacer"></div>   <!-- ★ 空白カラム -->
        ${[1,2,3].map(()=>`
          <select class="stone-select">
            <option value="">ストーン選択</option>
            ${Object.keys(POWER_STONES)
              .map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(POWER_STONES[n].ui)} (${escapeHtml(n)})</option>`)
              .join("")}
          </select>
        `).join("")}
      </div>
    `;

    slotArea.appendChild(row);
  });

  // イベント付与
  slotArea.querySelectorAll("select").forEach(sel=>{
    sel.addEventListener("change", handleChange);
  });
}

// ========== パワーストーン関連ロジック ==========

// 1スロット内で同じストーンが重複しないようにする
function enforceRowStoneUnique(row){
  const stoneSelects = Array.from(row.querySelectorAll(".stone-select"));
  const chosen = stoneSelects.map(s=>s.value).filter(v=>v);

  stoneSelects.forEach(sel=>{
    const current = sel.value;
    Array.from(sel.options).forEach(opt=>{
      if (!opt.value) return;
      opt.disabled = (opt.value !== current && chosen.includes(opt.value));
    });
  });
}

// 武器スロットのストーンを、空いている他スロットに「最初だけ」コピー
function syncWeaponStonesToAllSlotsOnce(){
  if (initialWeaponStoneSyncDone) return;

  const rows = Array.from(slotArea.querySelectorAll(".slot-row"));
  const weaponRow = rows.find(r => slotNameFromRow(r) === "武器");
  if (!weaponRow) return;

  const weaponStones = Array.from(weaponRow.querySelectorAll(".stone-select"))
    .map(sel => sel.value);

  rows.forEach(row=>{
    if (row === weaponRow) return; // 武器はスキップ

    const selects = Array.from(row.querySelectorAll(".stone-select"));
    selects.forEach((sel, i)=>{
      if (!sel.value && weaponStones[i]) {
        sel.value = weaponStones[i];
      }
    });

    enforceRowStoneUnique(row);
  });

  initialWeaponStoneSyncDone = true;
}

// ========== イベントハンドラ ==========

function handleChange(e){
  const sel = e.target;
  const row = sel.closest(".slot-row");

  // スロット内重複防止（ストーン）
  if (row && sel.classList.contains("stone-select")){
    enforceRowStoneUnique(row);

    // 武器のストーン変更 → 一度だけ全スロットにコピー
    if (slotNameFromRow(row) === "武器"){
      syncWeaponStonesToAllSlotsOnce();
    }
  }

  updateAll();
}

// 盾ON/OFF
useShieldCheck.addEventListener("change", ()=>{
  if (useShieldCheck.checked){
    if (!currentSlots.includes("盾")) currentSlots.push("盾");
  } else {
    currentSlots = currentSlots.filter(s => s !== "盾");
  }
  buildSlots();
  updateAll();
});

// リセットボタン
const resetBtn = document.getElementById("resetBtn");
if (resetBtn){
  resetBtn.addEventListener("click", ()=>{
    buildSlots();
    updateAll();
  });
}

// レベル変更
levelSelect.addEventListener("change", updateAll);

// ========== 計算処理 ==========

// パワーストーンの名前 → 対応するステ名に変換
function normalizeStoneStatName(stoneName){
  if (stoneName === "HP回復") return "HP再生";
  if (stoneName === "MP回復") return "MP再生";
  if (stoneName === "命中率") return "命中";
  if (stoneName === "回避率") return "回避";
  if (stoneName === "クリティカル率") return "クリティカル発生率";
  if (stoneName === "クリティカル防御率") return "クリティカル倍率";

  if (STAT_MAP[stoneName]) return stoneName;

  if (stoneName === "物理攻撃") return "物理攻撃力";
  if (stoneName === "魔法攻撃") return "魔法攻撃力";
  if (stoneName === "物理防御") return "物理防御力";
  if (stoneName === "魔法防御") return "魔法防御力";

  return null;
}

function updateAll(){
  const level = levelSelect.value; // "60","75","100","110"

  const rows = Array.from(slotArea.querySelectorAll(".slot-row"));

  const flatTotals = {}; // 加算系
  const pctTotals  = {}; // %系
  const talismanUsage = {}; // nameJP -> {count, rarity}
  const stoneUsage    = {}; // stoneName -> count

  // ▼ スロットごとの情報収集
  rows.forEach(row=>{
    const talSel = row.querySelector(".talisman-select");
    const rarSel = row.querySelector(".rarity-select");
    const stoneSelects = Array.from(row.querySelectorAll(".stone-select"));

    const talName = talSel.value;
    const rarity  = rarSel.value;

    if (talName){
      if (!talismanUsage[talName]) talismanUsage[talName] = { count:0, rarity };
      talismanUsage[talName].count += 1;
      talismanUsage[talName].rarity = rarity; // 最後に選んだレアで上書き
    }

    stoneSelects.forEach(sel=>{
      const sName = sel.value;
      if (!sName) return;

      stoneUsage[sName] = (stoneUsage[sName] || 0) + 1;

      const stoneDef = POWER_STONES[sName];
      if (!stoneDef) return;
      const val = stoneDef.values[level];
      if (val == null) return;

      const statName = normalizeStoneStatName(sName);
      if (!statName) return;

      if (isPercentStat(statName)){
        pctTotals[statName] = (pctTotals[statName] || 0) + val;
      } else {
        flatTotals[statName] = (flatTotals[statName] || 0) + val;
      }
    });
  });

  // ▼ タリスマンのセット効果計算
  const talDetailBlocks = [];

  Object.entries(talismanUsage).forEach(([nameJP, info])=>{
    const { count, rarity } = info;
    const tal = TALISMANS[nameJP];
    if (!tal) return;

    const sets = tal.sets[rarity] || {};
    let setKey = null;

    if (rarity === "uncommon"){
      if (count >= 4) setKey = "set4";
    } else if (rarity === "rare"){
      if (count === 3) setKey = "set3";
      else if (count >= 4) setKey = "set4";
    } else if (rarity === "legendary"){
      if (count === 2) setKey = "set2";
      else if (count === 3) setKey = "set3";
      else if (count >= 4) setKey = "set4";
    }

    if (!setKey || !sets[setKey]) return;

    const stats = sets[setKey];
    const lines = [];

    stats.forEach(statName=>{
      const statDef = STAT_MAP[statName];
      const val = statDef && statDef.values[level];
      if (val == null) return;

      if (isPercentStat(statName)){
        pctTotals[statName] = (pctTotals[statName] || 0) + val;
        const disp = Math.round(val * 1000) / 10; // 0.1 → 10.0%
        lines.push(`${statDef ? statDef.ui : statName} +${disp}%`);
      } else {
        flatTotals[statName] = (flatTotals[statName] || 0) + val;
        lines.push(`${statDef ? statDef.ui : statName} +${val}`);
      }
    });

    talDetailBlocks.push({
      nameJP,
      nameEN: tal.nameEN,
      rarity,
      count,
      setKey,
      lines
    });
  });

  // ▼ 合計ステ表示
  const allStats = new Set([
    ...Object.keys(flatTotals),
    ...Object.keys(pctTotals)
  ]);

  if (allStats.size === 0){
    totalArea.innerHTML = '<div class="muted">まだ何も選択されていません</div>';
  } else {
    const rowsHtml = Array.from(allStats).sort().map(statName=>{
      const def  = STAT_MAP[statName];
      const ui   = def ? def.ui  : statName;
      const tip  = def ? def.tip : statName;
      const flat = flatTotals[statName] || 0;
      const pct  = pctTotals[statName]  || 0;

      let valText = "";
      if (flat){
        valText += `+${flat}`;
      }
      if (pct){
        if (valText) valText += " / ";
        const disp = Math.round(pct * 1000) / 10; // 0.1 → 10.0%
        valText += `+${disp}%`;
      }

      return `
        <div class="stat-row" title="${escapeHtml(tip)}">
          <span>${escapeHtml(ui)}</span>
          <span>${escapeHtml(valText)}</span>
        </div>
      `;
    }).join("");

    totalArea.innerHTML = rowsHtml;
  }

  // ▼ タリスマン内訳
  if (talDetailBlocks.length === 0){
    talismanDetail.innerHTML = '<div class="muted">セット効果は発動していません</div>';
  } else {
    talismanDetail.innerHTML = talDetailBlocks.map(b=>{
      const alias = RARITY_ALIAS[b.rarity];
      const badgeClass = "rarity-" + alias;
      return `
        <div class="detail-block">
          <h4>
            ${escapeHtml(b.nameJP)}
            <span class="rarity-badge ${badgeClass}" title="${escapeHtml(RARITY_LABEL_JP[b.rarity])}">${alias}</span>
            <span class="muted">（${b.count}個 → ${escapeHtml(b.setKey.toUpperCase())}）</span>
          </h4>
          ${b.lines.map(line=>`<div>${escapeHtml(line)}</div>`).join("")}
        </div>
      `;
    }).join("");
  }

  // ▼ パワーストーン内訳
  const stoneEntries = Object.entries(stoneUsage);
  if (stoneEntries.length === 0){
    stoneDetail.innerHTML = '<div class="muted">パワーストーンは未設定です</div>';
  } else {
    stoneDetail.innerHTML = stoneEntries.map(([name,count])=>{
      const def = POWER_STONES[name];
      const statName = normalizeStoneStatName(name);
      const ui = def ? def.ui : name;
      const val = def && def.values[level];
      let valText = "";

      if (statName && isPercentStat(statName)){
        const disp = Math.round(val * 1000) / 10;
        valText = `+${disp}% × ${count}`;
      } else {
        valText = `+${val} × ${count}`;
      }

      const tip = def ? `${name} / ${def.tip}` : name;

      return `
        <div class="detail-block" title="${escapeHtml(tip)}">
          <h4>${escapeHtml(name)}（${count}個）</h4>
          <div>${escapeHtml(ui)}：${escapeHtml(valText)}</div>
        </div>
      `;
    }).join("");
  }
}

// ========== 効果一覧テーブル ==========

function buildEffectTable(){
  const mats = Object.values(TALISMANS);
  let rows = "";

  mats.forEach(mat=>{
    const name = mat.nameJP;
    const uncommon = mat.sets.uncommon || {};
    const rare     = mat.sets.rare     || {};
    const leg      = mat.sets.legendary|| {};

    const fmtSet = setObj=>{
      const order = ["set2","set3","set4"];
      return order.map(key=>{
        if (!setObj[key]) return "";
        const stats = setObj[key].map(stat=>{
          const def = STAT_MAP[stat];
          const ui  = def ? def.ui  : stat;
          const tip = def ? def.tip : stat;
          return `<span title="${escapeHtml(tip)}">${escapeHtml(ui)}</span>`;
        }).join("<br>");
        return `<div><strong>${escapeHtml(key.toUpperCase())}</strong><br>${stats}</div>`;
      }).filter(Boolean).join('<hr class="set-split">');
    };

    rows += `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td class="uncommon-col">${fmtSet(uncommon)}</td>
        <td class="rare-col">${fmtSet(rare)}</td>
        <td class="legend-col">${fmtSet(leg)}</td>
      </tr>
    `;
  });

  effectTableArea.innerHTML = `
    <div class="effect-table-wrap">
      <table class="effect-table">
        <thead>
          <tr>
            <th>タリスマン</th>
            <th>UNC（アンコモン）</th>
            <th>RARE（レア）</th>
            <th>LEG（レジェンダリー）</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ========== メモ自動保存 ==========

const MEMO_KEY = "talisman_sim_v2_memo";
const memoEl = document.getElementById("freeMemo");
if (memoEl){
  memoEl.value = localStorage.getItem(MEMO_KEY) || "";
  memoEl.addEventListener("input", ()=>{
    localStorage.setItem(MEMO_KEY, memoEl.value);
  });
}

// ========== 初期化 ==========

buildSlots();
buildEffectTable();
updateAll();
