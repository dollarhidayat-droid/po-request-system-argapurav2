import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/* ================= TIPE & KONSTANTA ================= */
type Vendor = {
  nama: string;
  alamat: string;
  npwp: string;
  telp: string;
  fax: string;
  pic: string;
  email: string;
};
type Pay = { rek: string; bank: string; cabang: string; an: string };
type Item = {
  id: number;
  d: string;
  q: string;
  s: string;
  p: string;
  k: string;
};
type Line = { d: string; q: number; s: string; p: number; k?: string };
type Status = 'Open' | 'Done';
type Hist = {
  id: string;
  iso: string;
  uid: string;
  by: string;
  dept: string;
  no: string;
  what: string;
}; // satu baris riwayat perubahan (change history)
type TKey = 'appr' | 'supp' | 'recv' | 'hoSend' | 'hoRecv' | 'pay'; // tanggal tiap tahap tracker (tahap 1 = tanggal PO dibuat, otomatis dari waktu submit)
type BP = { id: string; kode: string; nama: string; exp: string }; // Supplier BP (Business Partner): exp = tanggal expired (YYYY-MM-DD)
type PO = {
  no: string;
  iso: string;
  dept: string;
  uid: string;
  by: string;
  v: Vendor;
  items: Line[];
  sub: number;
  rate: number;
  disc: number;
  total: number;
  status: Status;
  doneAt?: string;
  pay?: Pay;
  ong?: number;
  note?: string;
  trk?: Partial<Record<TKey, string>>;
  suppLink?: string;
  rej?: string;
  rejWhy?: string;
  resent?: string;
  rejFinal?: boolean; // PO Reject (final): tidak bisa diedit/dikirim ulang/dibuka lagi; user membuat PO baru
  newNo?: string; // nomor PO pengganti (PO baru setelah reject final)
  prevNo?: string; // PO ini adalah pengganti dari nomor PO yang direject
  printN?: number; // berapa kali PO sudah dicetak
  printAt?: string; // waktu cetak terakhir
  printOk?: string; // waktu admin mengizinkan cetak ulang (hilang setelah dicetak lagi)
};
type User = {
  id: string;
  username?: string; // nama user untuk login (bukan email)
  nama: string;
  email: string;
  pass: string;
  dept: string;
  role: 'admin' | 'user';
  status: 'pending' | 'approved' | 'rejected';
};
type Draft = {
  v: Vendor;
  pay: Pay;
  items: Item[];
  disc?: string;
  ong?: string;
  rate?: string;
  note?: string;
  iso?: string;
  prev?: string; // nomor PO reject final yang digantikan (riwayat)
};
type Brand = {
  logo: string;
  bg: string;
  side: string;
  glass: number;
  sideBox?: boolean;
}; // logo & background halaman login (diatur admin); glass = transparansi kartu 0-100
const BRAND0: Brand = { logo: '', bg: '', side: '', glass: 50 };

/** Master departemen untuk pilihan. Admin dapat menambah/ubah/hapus di Pengaturan. Nomor PO memakai kode tetap PO_CODE. */
type Dept = { nama: string };
/** Master pajak (diatur admin di Pengaturan). tipe 'tambah' = PPN (menambah total), 'kurang' = PPh (mengurangi total). */
type Tax = { id: string; nama: string; persen: number; tipe: 'tambah' | 'kurang'; aktif: boolean };
const DEF_TAXES: Tax[] = [
  { id: 'ppn11', nama: 'PPN', persen: 11, tipe: 'tambah', aktif: true },
  { id: 'ppn12', nama: 'PPN', persen: 12, tipe: 'tambah', aktif: true },
  { id: 'pph23', nama: 'PPh 23', persen: 2, tipe: 'kurang', aktif: true },
];
/** rate bertanda pada PO: PPN = +0.11, PPh = -0.02 */
const taxRate = (t: Tax) => (t.tipe === 'kurang' ? -1 : 1) * Math.round(t.persen * 100) / 10000;
const pctTxt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const taxText = (t: Tax) => `${t.nama} ${pctTxt(t.persen)}%`;
/** nama pajak untuk rate bertanda (cari di master, kalau tidak ada: PPN/PPh bawaan) */
const taxName = (rate: number, taxes?: Tax[]) => {
  const k = Math.round(rate * 10000);
  const t = (taxes ?? []).find((x) => Math.round(taxRate(x) * 10000) === k);
  if (t) return taxText(t);
  return `${rate < 0 ? 'PPh' : 'PPN'} ${pctTxt(Math.abs(rate) * 100)}%`;
};
/** Format nomor PO: <urut>/AGP-PO/GA/<bulan romawi>/<tahun>, mis. 174/AGP-PO/GA/X/2026 */
const PO_CODE = 'GA';
const DEF_DEPTS: Dept[] = [
  { nama: 'Accounting' },
  { nama: 'Automotive Business Development' },
  { nama: 'Business Development' },
  { nama: 'Engineering & Project' },
  { nama: 'Facility & Service' },
  { nama: 'Finance' },
  { nama: 'General Sales' },
  { nama: 'IT/Digital Transform' },
  { nama: 'Operation Support' },
  { nama: 'Production' },
  { nama: 'Purchasing & Supplier Management' },
  { nama: 'QA/QC' },
  { nama: 'Supply Chain' },
  { nama: 'Talent' },
  { nama: 'Technical' },
];
/** Nama departemen versi lama -> departemen baru (dipakai sekali saat migrasi data lama). */
const LEGACY_DEPT: Record<string, string> = {
  'HR Department': 'Talent',
  Purchasing: 'Purchasing & Supplier Management',
  Produksi: 'Production',
  Marketing: 'General Sales',
  IT: 'IT/Digital Transform',
};
const deptSort = (list: Dept[]) =>
  list.map((d) => d.nama).sort((a, b) => a.localeCompare(b, 'id'));
const UNITS = [
  'Pcs',
  'Unit',
  'Box',
  'Rim',
  'Set',
  'Paket',
  'Kg',
  'Meter',
  'Jasa',
];
const STATUSES: Status[] = ['Open', 'Done'];
/* Tahapan tracker PO (urut). by = siapa yang boleh mengisi tanggal: auto (otomatis), admin, creator (hanya user pembuat PO), atau both (pembuat PO dan admin).
   Ubah kolom "by" di sini bila pembagian tugasnya berbeda. */
const TSTEPS: {
  k: 'made' | TKey;
  l: string;
  by: 'auto' | 'admin' | 'user' | 'creator' | 'both';
}[] = [
  { k: 'made', l: 'PO dibuat', by: 'auto' },
  { k: 'appr', l: 'PO di-approve', by: 'both' }, // = PO sudah ditandatangani atasan. Diisi manual (admin atau user pembuat PO), TIDAK otomatis dari tombol Done admin
  { k: 'supp', l: 'PO dikirim ke supplier', by: 'creator' }, // diisi tanggal oleh user pembuat PO
  { k: 'hoSend', l: 'PO dikirim ke kantor pusat', by: 'admin' },
  { k: 'hoRecv', l: 'PO sampai di kantor pusat', by: 'admin' },
  { k: 'recv', l: 'Barang diterima', by: 'both' }, // diisi user pembuat PO atau admin
  { k: 'pay', l: 'PO proses pembayaran', by: 'admin' },
];
const pad2 = (n: number) => String(n).padStart(2, '0');
/** Satu departemen = sama (abaikan huruf besar/kecil & spasi), siapa pun pembuatnya. Dipakai untuk membatasi data user ke departemennya. */
const sameDept = (a?: string, b?: string) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayOf = (x: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : ymd(new Date(x));
const MON_ID: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7,
  aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, nop: 11,
  dec: 12, des: 12,
};
const MON_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const okYMD = (y: number, m: number, d: number) => {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d
    ? `${y}-${pad2(m)}-${pad2(d)}`
    : null;
};
/** Baca tanggal dari sheet dengan format apa pun -> YYYY-MM-DD (null bila tidak terbaca).
 *  Mendukung: 22-Mar-2026, 7 Dec 2025, 2-Nov-2026, 29 November 2025, 22/03/2026, 2026-03-22, ISO datetime, serial Excel. */
const parseExp = (raw: string): string | null => {
  const x = String(raw ?? '').trim();
  if (!x) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(x);
  if (m) return okYMD(+m[1], +m[2], +m[3]);
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(x)) {
    const t = new Date(x);
    return isNaN(t.getTime()) ? null : ymd(t);
  }
  m = /^(\d{1,2})[\s.\-\/]+([A-Za-z]{3,})\.?[\s.\-\/,]+(\d{2,4})$/.exec(x);
  if (m) {
    const mo = MON_ID[m[2].slice(0, 3).toLowerCase()];
    let y = +m[3];
    if (y < 100) y += 2000;
    return mo ? okYMD(y, mo, +m[1]) : null;
  }
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(x);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return okYMD(y, +m[2], +m[1]); // hari/bulan/tahun (format Indonesia)
  }
  if (/^\d{5}$/.test(x)) {
    const t = new Date(Date.UTC(1899, 11, 30) + Number(x) * 86400000);
    return okYMD(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const t = new Date(x);
  return isNaN(t.getTime()) ? null : ymd(t);
};
/** Tanggal untuk ditulis ke sheet: format sama seperti kolom exp di sheet, mis. 22-Mar-2026 */
const toSheetD = (x: string) => {
  const p = parseExp(x);
  if (!p) return x;
  const [y, m, d] = p.split('-').map(Number);
  return `${d}-${MON_EN[m - 1]}-${y}`;
};
const fmtD = (x: string) => {
  const iso = parseExp(x);
  if (!iso) return x || '-';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};
const stepDate = (p: PO, k: string) =>
  k === 'made' ? p.iso : p.trk?.[k as TKey];
/** Status tracker: tahap pertama yang belum punya tanggal otomatis menjadi "Progress", tahap sesudahnya "Open". */
const trackOf = (p: PO) => {
  const dates = TSTEPS.map((x) => stepDate(p, x.k));
  const cur = dates.findIndex((x) => !x);
  return { dates, cur, done: dates.filter(Boolean).length, all: cur === -1 };
};
/** Status Supplier BP dihitung otomatis dari tanggal expired. */
const bpInfo = (exp: string) => {
  const iso = parseExp(exp);
  if (!iso) return { days: 0, expired: false, soon: false, bad: true };
  const t = new Date();
  const [y, m, d] = iso.split('-').map(Number);
  const days = Math.round(
    (new Date(y, m - 1, d).getTime() -
      new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) /
      86400000
  );
  return { days, expired: days < 0, soon: days >= 0 && days <= 30, bad: false };
};
/** Supplier BP milik vendor sebuah PO (dicocokkan lewat nama) + status expired-nya. */
const bpOfPo = (bps: BP[], p: PO) => {
  const bp = bps.find(
    (b) => supKey(b.nama) === supKey(p.v.nama)
  );
  return { bp, bi: bp ? bpInfo(bp.exp) : null };
};
/** Alasan otomatis bila Supplier BP vendor bermasalah ("" bila aktif). Dipakai sebagai usulan alasan penolakan. */
const bpWhy = (bps: BP[], p: PO) => {
  const { bp, bi } = bpOfPo(bps, p);
  if (!bp || !bi) return 'Vendor belum terdaftar sebagai Supplier BP';
  if (bi.expired)
    return `Supplier BP ${bp.kode} (${bp.nama}) sudah Expired sejak ${fmtD(
      bp.exp
    )}`;
  if (bi.soon)
    return `Supplier BP ${bp.kode} (${bp.nama}) akan Expired ${fmtD(bp.exp)}`;
  return '';
};
const DEF_BP: BP[] = [
  // data contoh (dummy) - admin bisa ubah/hapus/tambah di menu Data Supplier
  { id: 'bp1', kode: 'BP-001', nama: 'PT Sinar Jaya Abadi', exp: '2027-06-30' },
  {
    id: 'bp2',
    kode: 'BP-002',
    nama: 'CV Mitra Karya Sejahtera',
    exp: '2026-11-20',
  },
  {
    id: 'bp3',
    kode: 'BP-003',
    nama: 'PT Global Office Supplies',
    exp: '2026-08-31',
  },
  {
    id: 'bp4',
    kode: 'BP-004',
    nama: 'PT Safety Indo Perkasa',
    exp: '2027-02-28',
  },
  { id: 'bp5', kode: 'BP-005', nama: 'CV Berkah Teknik', exp: '2026-05-15' },
  {
    id: 'bp6',
    kode: 'BP-006',
    nama: 'PT Cahaya Packaging Nusantara',
    exp: '2027-12-31',
  },
  { id: 'bp7', kode: 'BP-007', nama: 'UD Maju Bersama', exp: '2026-12-15' },
  {
    id: 'bp8',
    kode: 'BP-008',
    nama: 'PT Triputra Logistik',
    exp: '2027-09-30',
  },
];
const isAppr = (p: PO) => p.status === 'Done'; // approved (admin) = ditandai Done. Tanggal tracker "PO di-approve" (tanda tangan atasan) terpisah, diisi manual
const isWait = (p: PO) => !p.rej && !isAppr(p); // menunggu approval (rej = tanggal ditolak admin)
const EMPTY_PAY: Pay = { rek: '', bank: '', cabang: '', an: '' };
const EMPTY: Vendor = {
  nama: '',
  alamat: '',
  npwp: '',
  telp: '',
  fax: '',
  pic: '',
  email: '',
};
/* ================= MASTER SUPPLIER (admin upload Excel / CSV / PDF -> dipakai semua user) =================
   Format kolom (urutan bebas, nama kolom dikenali otomatis):
   Vendor Name | Alamat | Provinsi | NPWP | Phone | Fax | PIC | Departement | Email | No Rek | Bank | Cabang | Atas nama */
type MSup = {
  id: string;
  nama: string;
  alamat: string;
  provinsi: string;
  npwp: string;
  telp: string;
  fax: string;
  pic: string;
  dept: string;
  email: string;
  rek: string;
  bank: string;
  cabang: string;
  an: string;
};
type MKey = Exclude<keyof MSup, 'id'>;
type MsRow = Record<MKey, string>;
type MsCell = string | number;
const MS_KEYS: { k: MKey; l: string; syn: string[] }[] = [
  { k: 'nama', l: 'Vendor Name', syn: ['vendorname', 'namavendor', 'vendor', 'namasupplier', 'supplier', 'suppliername', 'namaperusahaan', 'perusahaan', 'nama'] },
  { k: 'alamat', l: 'Alamat', syn: ['alamat', 'alamatvendor', 'address'] },
  { k: 'provinsi', l: 'Provinsi', syn: ['provinsi', 'province'] },
  { k: 'npwp', l: 'NPWP', syn: ['npwp', 'nonpwp', 'nomornpwp'] },
  { k: 'telp', l: 'Phone', syn: ['phone', 'telepon', 'telp', 'notelp', 'notelepon', 'notelpon', 'nohp', 'phonenumber', 'teleponvendor'] },
  { k: 'fax', l: 'Fax', syn: ['fax', 'nofax'] },
  { k: 'pic', l: 'PIC', syn: ['pic', 'namapic', 'picvendor', 'contactperson', 'kontak'] },
  { k: 'dept', l: 'Departement', syn: ['departement', 'departemen', 'department', 'dept'] },
  { k: 'email', l: 'Email', syn: ['email', 'emailvendor'] },
  { k: 'rek', l: 'No Rek', syn: ['norek', 'norekening', 'nomorrekening', 'rekening', 'accountno', 'accountnumber', 'norekbank'] },
  { k: 'bank', l: 'Bank', syn: ['bank', 'namabank'] },
  { k: 'cabang', l: 'Cabang', syn: ['cabang', 'cabangbank', 'branch'] },
  { k: 'an', l: 'Atas nama', syn: ['atasnama', 'an', 'namarekening', 'accountname', 'pemilikrekening', 'atasnamarekening'] },
];
const MS_PO_REQ: MKey[] = ['alamat', 'email', 'npwp', 'pic', 'telp', 'rek', 'bank', 'cabang', 'an']; // isian form PO yang wajib diisi (selain Fax)
const msNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Kunci nama supplier: bentuk badan usaha (PT, CV, UD, PD, FA, Tbk, Persero) dan tanda baca diabaikan, di depan maupun di belakang.
    "PT VICTORINDO KIMIATAMA", "VICTORINDO KIMIATAMA, PT" dan "P.T. Victorindo Kimiatama" → kunci yang sama. */
const ENTITY_WORDS = new Set(['pt', 'cv', 'ud', 'pd', 'fa', 'tbk', 'persero']);
const supKey = (s: string) => {
  const t = (s ?? '')
    .toLowerCase()
    .replace(/\bp\.\s?t\b\.?/g, ' pt ')
    .replace(/\bc\.\s?v\b\.?/g, ' cv ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !ENTITY_WORDS.has(w))
    .join('');
  return t || msNorm(s ?? '');
};
const msTxt = (x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim();
const msField = (h: string): MKey | null => {
  const n = msNorm(h);
  if (!n) return null;
  return MS_KEYS.find((x) => x.syn.includes(n))?.k ?? null;
};
/** nilai sel -> teks rapi (angka Excel tidak jadi 1.68E+12, nol di depan nomor telepon dipulihkan, NPWP 15 digit diberi titik) */
const msCell = (c: MsCell | undefined, k: MKey): string => {
  if (c === undefined || c === null) return '';
  let s = typeof c === 'number' ? (Number.isInteger(c) ? c.toFixed(0) : String(c)) : msTxt(c);
  if (typeof c === 'number' && (k === 'telp' || k === 'fax') && /^[1-9]\d{7,11}$/.test(s)) s = '0' + s;
  if (k === 'npwp' && /^\d{15}$/.test(s))
    s = `${s.slice(0, 2)}.${s.slice(2, 5)}.${s.slice(5, 8)}.${s[8]}-${s.slice(9, 12)}.${s.slice(12)}`;
  return s;
};

type MsParse = { rows: MsRow[]; skipped: number; fields: MKey[]; ok: boolean };
/** kumpulan tabel (tiap sheet Excel / tiap halaman PDF) -> baris supplier. Header dicari otomatis & dipakai untuk halaman berikutnya. */
function msParse(grids: MsCell[][][]): MsParse {
  const rows: MsRow[] = [];
  const found = new Set<MKey>();
  let skipped = 0;
  let map: (MKey | null)[] | null = null;
  for (const g of grids) {
    const width = g.reduce((m, r) => Math.max(m, r.length), 0);
    let m: (MKey | null)[] | null = map && map.length === width ? map : null;
    let start = 0;
    for (let i = 0; i < Math.min(g.length, 40); i++) {
      const hm = g[i].map((c) => msField(msTxt(c)));
      const set = new Set(hm.filter(Boolean));
      if (set.size >= 3 && set.has('nama')) {
        m = hm;
        map = hm;
        start = i + 1;
        break;
      }
    }
    if (!m) continue;
    m.forEach((k) => k && found.add(k));
    for (let i = start; i < g.length; i++) {
      const hm = new Set(g[i].map((c) => msField(msTxt(c))).filter(Boolean));
      if (hm.size >= 3) continue; // baris judul kolom yang berulang di tiap halaman
      const r = {} as MsRow;
      MS_KEYS.forEach(({ k }) => (r[k] = ''));
      m.forEach((k, j) => {
        if (!k) return;
        const v = msCell(g[i][j], k);
        if (v && !r[k]) r[k] = v;
      });
      if (!MS_KEYS.some(({ k }) => r[k])) continue; // baris kosong
      if (!r.nama) {
        skipped++;
        continue;
      }
      rows.push(r);
    }
  }
  return { rows, skipped, fields: MS_KEYS.map((x) => x.k).filter((k) => found.has(k)), ok: rows.length > 0 };
}

/** gabungkan ke daftar master: nama sama = diperbarui (kolom kosong di file tidak menghapus data lama), selain itu = baru */
function msMerge(cur: MSup[], inc: MsRow[], replace: boolean) {
  const base: MSup[] = replace ? [] : cur.map((x) => ({ ...x }));
  const byName = new Map<string, number>();
  const ids = new Set<string>();
  const idx = (m: MSup, i: number) => {
    byName.set(supKey(m.nama), i);
    ids.add(m.id);
  };
  base.forEach(idx);
  let add = 0,
    upd = 0,
    same = 0;
  inc.forEach((r) => {
    const i = byName.get(supKey(r.nama));
    if (i !== undefined) {
      const o = base[i];
      const n = { ...o };
      MS_KEYS.forEach(({ k }) => {
        if (r[k]) n[k] = r[k];
      });
      if (JSON.stringify(n) !== JSON.stringify(o)) upd++;
      else same++;
      base[i] = n;
      idx(n, i);
    } else {
      let id = 'ms-' + hash32(supKey(r.nama)).toString(36);
      for (let c = 2; ids.has(id); c++) id = 'ms-' + hash32(supKey(r.nama)).toString(36) + '-' + c;
      const m: MSup = { id, ...r };
      base.push(m);
      idx(m, base.length - 1);
      add++;
    }
  });
  return { list: base, add, upd, same };
}
/** kolom wajib form PO yang masih kosong pada satu supplier */
const msMissing = (m: MsRow | MSup) => MS_PO_REQ.filter((k) => !m[k].trim());

/** data master -> isian form PO (Vendor + Pembayaran) */
const msToVendor = (m: MSup): Vendor => {
  const a = m.alamat.trim();
  const pv = m.provinsi.trim();
  return {
    nama: m.nama,
    alamat: pv && !a.toLowerCase().includes(pv.toLowerCase()) ? (a ? a + ', ' + pv : pv) : a,
    npwp: m.npwp,
    telp: m.telp,
    fax: m.fax,
    pic: m.pic,
    email: m.email,
  };
};
const msToPay = (m: MSup): Pay => ({ rek: m.rek, bank: m.bank, cabang: m.cabang, an: m.an });

/* ---- pembaca file: SheetJS (Excel/CSV) & pdf.js (PDF) dimuat dari CDN saat dibutuhkan ---- */
/* eslint-disable @typescript-eslint/no-explicit-any */
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const msScript = (src: string, ready: () => unknown) =>
  new Promise<void>((res, rej) => {
    if (ready()) return res();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (ready() ? res() : rej(new Error('Pustaka tidak termuat')));
    s.onerror = () => rej(new Error('Tidak bisa memuat ' + src));
    document.head.appendChild(s);
  });
const msXlsx = async (): Promise<any> => {
  await msScript(XLSX_URL, () => (window as any).XLSX);
  return (window as any).XLSX;
};
const msPdfLib = async (): Promise<any> => {
  await msScript(PDFJS_URL, () => (window as any).pdfjsLib);
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return lib;
};
const msCluster = (a: number[], tol: number) => {
  const s = [...a].sort((x, y) => x - y);
  const out: number[] = [];
  let g: number[] = [];
  const flush = () => g.length && out.push(g.reduce((x, y) => x + y, 0) / g.length);
  s.forEach((v) => {
    if (g.length && v - g[g.length - 1] > tol) {
      flush();
      g = [];
    }
    g.push(v);
  });
  flush();
  return out;
};
/** PDF -> satu tabel per halaman. Kolom/baris dibaca dari garis tabel PDF (hasil cetak Excel); tanpa garis, memakai posisi judul kolom. */
async function msPdfGrids(lib: any, data: Uint8Array): Promise<string[][][]> {
  const doc = await lib.getDocument({ data }).promise;
  const OPS = lib.OPS;
  const out: string[][][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as any[])
      .map((i) => ({ s: String(i.str), x: i.transform[4] as number, y: i.transform[5] as number, w: i.width as number }))
      .filter((i) => i.s.trim());
    if (!items.length) continue;
    const ol = await page.getOperatorList();
    const vx: number[] = [];
    const hy: number[] = [];
    ol.fnArray.forEach((fn: number, n: number) => {
      if (fn !== OPS.constructPath) return;
      const pops: number[] = ol.argsArray[n][0];
      const co: ArrayLike<number> = ol.argsArray[n][1];
      let c = 0,
        cx = 0,
        cy = 0;
      for (const op of pops) {
        if (op === OPS.rectangle) {
          const x = co[c],
            y = co[c + 1],
            w = co[c + 2],
            h = co[c + 3];
          c += 4;
          if (Math.abs(w) < 4 && Math.abs(h) > 5) vx.push(x + w / 2);
          else if (Math.abs(h) < 4 && Math.abs(w) > 5) hy.push(y + h / 2);
        } else if (op === OPS.moveTo) {
          cx = co[c];
          cy = co[c + 1];
          c += 2;
        } else if (op === OPS.lineTo) {
          const nx = co[c],
            ny = co[c + 1];
          c += 2;
          if (Math.abs(nx - cx) < 0.6 && Math.abs(ny - cy) > 5) vx.push((nx + cx) / 2);
          else if (Math.abs(ny - cy) < 0.6 && Math.abs(nx - cx) > 5) hy.push((ny + cy) / 2);
          cx = nx;
          cy = ny;
        } else if (op === OPS.curveTo) c += 6;
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) c += 4;
      }
    });
    let edges = msCluster(vx, 2);
    const rlines = msCluster(hy, 1.5).sort((a, b) => b - a);
    // tanpa garis kolom: batas kolom dari posisi judul kolom pada baris judul
    if (edges.length < 4) {
      const lines = new Map<number, typeof items>();
      items.forEach((i) => {
        const k = Math.round(i.y / 2);
        lines.set(k, [...(lines.get(k) ?? []), i]);
      });
      let best: typeof items = [];
      lines.forEach((l) => {
        const hs = l.filter((i) => msField(i.s)).sort((a, b) => a.x - b.x);
        if (hs.length > best.length) best = hs;
      });
      if (best.length < 3) continue;
      edges = [-1e6];
      for (let i = 0; i < best.length - 1; i++) edges.push((best[i].x + best[i].w + best[i + 1].x) / 2);
      edges.push(1e6);
    }
    const colOf = (it: { x: number; w: number }) => {
      const at = (x: number) => {
        for (let i = 0; i < edges.length - 1; i++) if (x >= edges[i] - 0.5 && x < edges[i + 1] - 0.5) return i;
        return -1;
      };
      const si = at(it.x + 0.5);
      const ci = at(it.x + it.w / 2);
      if (si === ci) return si;
      if (si >= 0 && it.x - edges[si] <= 5) return si; // teks rata kiri yang melebar ke kolom sebelah
      return ci >= 0 ? ci : si; // teks rata tengah / kanan
    };
    const ncol = edges.length - 1;
    const cells = new Map<number, typeof items[]>(); // baris -> kolom -> item
    const put = (r: number, c: number, it: (typeof items)[number]) => {
      if (c < 0) return;
      const row = cells.get(r) ?? Array.from({ length: ncol }, () => [] as typeof items);
      row[c].push(it);
      cells.set(r, row);
    };
    if (rlines.length >= 3) {
      items.forEach((it) => {
        for (let r = 0; r < rlines.length - 1; r++)
          if (it.y <= rlines[r] + 0.5 && it.y > rlines[r + 1] - 0.5) {
            put(r, colOf(it), it);
            return;
          }
      });
    } else {
      // tanpa garis baris: tiap baris teks = satu baris; baris lanjutan (kolom pertama kosong) digabung ke baris di atasnya
      // baris baru dikenali dari kolom pertama berisi teks + jarak antarbaris lebih lebar daripada jarak baris lanjutan (teks yang membungkus)
      const ys = msCluster(items.map((i) => i.y), 2).sort((a, b) => b - a);
      const gs = ys.slice(1).map((y, i) => ys[i] - y);
      const gMin = gs.length ? Math.min(...gs) : 0;
      const wraps = gs.some((g) => g > gMin * 1.04);
      let cur = -1;
      ys.forEach((y, n) => {
        const its = items.filter((i) => Math.abs(i.y - y) <= 2);
        const first = its.some((i) => colOf(i) === 0);
        if (cur < 0 || (first && (!wraps || gs[n - 1] > gMin * 1.04))) cur = Math.round(y * 10);
        its.forEach((i) => put(cur, colOf(i), i));
      });
    }
    const keys = [...cells.keys()].sort((a, b) => (rlines.length >= 3 ? a - b : b - a));
    const grid = keys.map((k) =>
      cells.get(k)!.map((col) =>
        msTxt([...col].sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.s).join(' '))
      )
    );
    out.push(grid.filter((r) => r.some(Boolean)));
  }
  return out;
}
/** berkas Excel / CSV / PDF -> hasil baca */
async function msReadFile(file: File): Promise<MsParse> {
  const buf = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const lib = await msPdfLib();
    return msParse(await msPdfGrids(lib, new Uint8Array(buf)));
  }
  const X = await msXlsx();
  const wb = X.read(new Uint8Array(buf), { type: 'array' });
  const grids: MsCell[][][] = wb.SheetNames.map(
    (n: string) => X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) as MsCell[][]
  );
  return msParse(grids);
}
/** unduh template Excel dengan susunan kolom yang sama seperti format PDF */
async function msTemplate() {
  const X = await msXlsx();
  const ws = X.utils.aoa_to_sheet([
    MS_KEYS.map((x) => x.l),
    [
      'CV. CONTOH SUPPLIER',
      'Jl. Contoh No 1, Kel. Contoh, Kec. Contoh, Jakarta Barat',
      'DKI Jakarta',
      '00.000.000.0-000.000',
      '021-12345678',
      '',
      'Nama PIC',
      'LOGISTIK',
      'contoh@supplier.com',
      '1234567890',
      'Bank Mandiri',
      'KCP Jakarta Pluit',
      'CV. CONTOH SUPPLIER',
    ],
  ]);
  ws['!cols'] = MS_KEYS.map((_, i) => ({ wch: i === 1 ? 46 : 22 }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Master Supplier');
  X.writeFile(wb, 'Template_Master_Supplier.xlsx');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ================= KEAMANAN PASSWORD =================
   Password tidak lagi disimpan/di-sinkron sebagai teks biasa: disimpan sebagai hash PBKDF2-SHA256 + salt acak per akun
   (format "pbkdf2$iterasi$salt$hash"). Password lama (teks biasa) tetap bisa login satu kali lalu otomatis di-hash. */
const PW_ITER = 150000;
const PW_WEAK = ['admin123', 'demo123', '123456', 'password', '12345678'];
const hex_ = (b: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(b as ArrayBuffer), (x) => x.toString(16).padStart(2, '0')).join('');
const unhex_ = (h: string) =>
  new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const pbkdf2_ = async (pw: string, salt: Uint8Array, iter: number) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex_(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256));
};
const isHashed = (p: string) => /^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(p);
async function hashPw(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PW_ITER}$${hex_(salt)}$${await pbkdf2_(pw, salt, PW_ITER)}`;
}
const sameStr = (a: string, b: string) => {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
};
async function verifyPw(pw: string, stored: string) {
  if (!stored) return false;
  if (!isHashed(stored)) return sameStr(pw, stored); // password lama (teks biasa) -> di-upgrade setelah login
  const [, it, salt, h] = stored.split('$');
  return sameStr(await pbkdf2_(pw, unhex_(salt), Number(it)), h);
}
/** password sementara acak (kriptografis), tanpa karakter yang mudah tertukar */
const tmpPw = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return 'Agp' + Array.from(crypto.getRandomValues(new Uint8Array(9)), (x) => A[x % A.length]).join('');
};
/** pembatas percobaan login (sisi browser): 5x salah -> kunci 5 menit per username */
const FAIL_KEY = 'po_fail';
const failMap = (): Record<string, { n: number; t: number }> => {
  try {
    return JSON.parse(localStorage.getItem(FAIL_KEY) || '{}');
  } catch {
    return {};
  }
};
const lockLeft = (un: string) => {
  const r = failMap()[un];
  return r && r.n >= 5 ? Math.max(0, r.t + 5 * 60000 - Date.now()) : 0;
};
const noteFail = (un: string, ok: boolean) => {
  try {
    const m = failMap();
    const r = m[un];
    if (ok) delete m[un];
    else m[un] = { n: r && Date.now() - r.t < 5 * 60000 ? r.n + 1 : 1, t: Date.now() };
    localStorage.setItem(FAIL_KEY, JSON.stringify(m));
  } catch {
    /* abaikan */
  }
};
let WEAK_LOGIN = false; // true bila user baru saja masuk memakai password default/lemah -> wajib diganti

// Akun admin awal. Password awal hanya untuk instalasi baru dan WAJIB diganti saat login pertama (tidak lagi dipaksa kembali setiap aplikasi dibuka).
const ADMIN: User = {
  id: 'admin',
  username: 'admin',
  nama: 'Admin PO',
  email: 'dollar.hidayat@argapura.com',
  pass: 'admin123',
  dept: 'Admin',
  role: 'admin',
  status: 'approved',
};

/** Username login. Akun lama tanpa username memakai bagian depan email. */
const uname = (u: { id?: string; username?: string; email: string }) =>
  u.id === 'admin'
    ? 'admin' // akun admin utama selalu login dengan username "admin", apa pun isi sheet
    : (u.username?.trim() || u.email.split('@')[0]).toLowerCase();

let uid = 1;
const newItem = (p?: Partial<Item>): Item => ({
  id: uid++,
  d: '',
  q: '',
  s: '',
  p: '',
  k: '',
  ...p,
});
const rp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
// Format nomor mengikuti contoh PO: 174/AGP-PO/GA/X/2026  (urut/AGP-PO/kode dept/bulan romawi/tahun)
const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];
/** Pengaturan per tahun (admin): start = nomor awal, locked = periode dikunci. Tahun yang sudah lewat otomatis terkunci kecuali admin membukanya. */
type YearCfg = { start?: number; locked?: boolean; free?: number[] }; // free = nomor urut PO yang di-Cancel (dilepas), dipakai lagi oleh pengajuan berikutnya
type NumCfg = Record<string, YearCfg>;
const lockedYear = (cfg: NumCfg, y: number) =>
  cfg[String(y)]?.locked ?? y < new Date().getFullYear();
/** Nomor urut terbesar yang sudah terpakai pada suatu tahun (semua departemen berbagi satu urutan). */
const lastSeq = (pos: PO[], y: number) =>
  pos.reduce((m, p) => {
    const x = /^(\d+)\/AGP-PO\/[^/]+\/[^/]+\/(\d{4})$/.exec(p.no);
    return x && Number(x[2]) === y ? Math.max(m, Number(x[1])) : m;
  }, 0);
/** Nomor berikutnya = lanjut dari nomor terbesar, tetapi tidak lebih kecil dari nomor awal yang diset admin. Tahun baru otomatis mulai dari 1. */
const usedSeqs = (pos: PO[], y: number) => {
  const s = new Set<number>();
  pos.forEach((p) => {
    const x = /^(\d+)\/AGP-PO\/[^/]+\/[^/]+\/(\d{4})$/.exec(p.no);
    if (x && Number(x[2]) === y) s.add(Number(x[1]));
  });
  return s;
};
/** Nomor yang dilepas karena Cancel dipakai dulu (yang terkecil); bila tidak ada, lanjut dari nomor terbesar. PO Reject tetap memegang nomornya. */
const nextSeq = (pos: PO[], y: number, cfg: NumCfg) => {
  const start = cfg[String(y)]?.start ?? 1;
  const used = usedSeqs(pos, y);
  const free = (cfg[String(y)]?.free ?? []).filter((n) => n >= start && !used.has(n));
  return Math.min(...free, Math.max(lastSeq(pos, y) + 1, start));
};
/** Nomor PO dari urutan tertentu pada tahun berjalan (dipakai saat Cancel untuk melepas nomor) */
const seqOf = (no: string) => {
  const x = /^(\d+)\/AGP-PO\/[^/]+\/[^/]+\/(\d{4})$/.exec(no);
  return x ? { n: Number(x[1]), y: x[2] } : null;
};
const nextNo = (pos: PO[], cfg: NumCfg = {}) => {
  const d = new Date();
  const y = d.getFullYear();
  return `${String(nextSeq(pos, y, cfg)).padStart(3, '0')}/AGP-PO/${PO_CODE}/${
    ROMAN[d.getMonth()]
  }/${y}`;
};
// rate bertanda: PPN positif (menambah), PPh negatif (mengurangi). Sub Total 2 = Sub Total 1 - Diskon; pajak dihitung dari Sub Total 2; TOTAL = Sub Total 2 + PPN + Ongkir
const calc = (sub: number, rate: number, disc: number, ong: number) => {
  const s2 = Math.max(0, sub - disc);
  const ppn = Math.round(s2 * rate);
  return { s2, ppn, total: s2 + ppn + ong };
};

/* Penyimpanan sementara di browser. Nanti diganti Supabase agar data dipakai bersama banyak user. */
function useLS<T>(key: string, init: T) {
  const [s, setS] = useState<T>(() => {
    try {
      const r = localStorage.getItem(key);
      return r ? (JSON.parse(r) as T) : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(s));
    } catch {
      /* abaikan */
    }
  }, [key, s]);
  // Sinkron antar tab/jendela browser: perubahan di satu tab langsung terbaca di tab lain (mengurangi data saling menimpa)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setS(JSON.parse(e.newValue) as T);
        } catch {
          /* abaikan */
        }
      }
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [key]);
  return [s, setS] as const;
}

/** ID unik (UUID acak) agar banyak user/PO/catatan tidak pernah bentrok. */
const newId = (prefix: string) =>
  prefix +
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
/** Nomor PO unik: bila nomor sudah dipakai, nomor urut dinaikkan sampai tidak bentrok. */
const uniqueNo = (no: string, taken: Set<string>) => {
  const m = /^(\d+)(\/.*)$/.exec(no);
  if (!m)
    return taken.has(no)
      ? no + '-' + Math.random().toString(36).slice(2, 6)
      : no;
  let n = Number(m[1]);
  let out = no;
  while (taken.has(out)) {
    n += 1;
    out = String(n).padStart(m[1].length, '0') + m[2];
  }
  return out;
};
const hash32 = (t: string) => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++)
    h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Baca file gambar, kecilkan, lalu kembalikan data URL (agar muat di penyimpanan browser). */
function readImage(
  file: File,
  max: number,
  type: 'image/png' | 'image/jpeg'
): Promise<string> {
  return new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onerror = () => fail(new Error('Gagal membaca file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => fail(new Error('File bukan gambar yang valid'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        const g = c.getContext('2d');
        if (!g) return fail(new Error('Canvas tidak tersedia'));
        if (type === 'image/jpeg') {
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
        }
        g.drawImage(img, 0, 0, c.width, c.height);
        if (type === 'image/png') {
          // pangkas tepi transparan agar tidak ada ruang kosong di sekitar logo
          try {
            const { data } = g.getImageData(0, 0, c.width, c.height);
            let x0 = c.width,
              y0 = c.height,
              x1 = -1,
              y1 = -1;
            for (let y = 0; y < c.height; y++)
              for (let x = 0; x < c.width; x++)
                if (data[(y * c.width + x) * 4 + 3] > 12) {
                  if (x < x0) x0 = x;
                  if (x > x1) x1 = x;
                  if (y < y0) y0 = y;
                  if (y > y1) y1 = y;
                }
            if (
              x1 >= x0 &&
              y1 >= y0 &&
              (x1 - x0 + 1 < c.width || y1 - y0 + 1 < c.height)
            ) {
              const w = x1 - x0 + 1,
                h = y1 - y0 + 1,
                t = document.createElement('canvas');
              t.width = w;
              t.height = h;
              t.getContext('2d')?.drawImage(c, x0, y0, w, h, 0, 0, w, h);
              return ok(t.toDataURL(type));
            }
          } catch {
            /* abaikan, pakai gambar utuh */
          }
        }
        ok(c.toDataURL(type, 0.8));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

function Field({
  label,
  req,
  children,
}: {
  label: string;
  req?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fld">
      <label>
        {label} {req && <i>*</i>}
      </label>
      {children}
    </div>
  );
}

/* ================= IKON & KARTU ================= */
const P = (d: string) => <path d={d} />;
const FILE_D = 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z';
const IC: Record<string, ReactNode> = {
  home: P('M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      {P('m20 20-3.5-3.5')}
    </>
  ),
  bell: (
    <>
      {P('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9')}
      {P('M10.3 21a1.9 1.9 0 0 0 3.4 0')}
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      {P('M4 21a8 8 0 0 1 16 0')}
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      {P('M2.5 20a6.5 6.5 0 0 1 13 0')}
      <circle cx="17" cy="9" r="2.8" />
      {P('M17 14.5a5.5 5.5 0 0 1 4.5 5.5')}
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 7v5l3 2')}
    </>
  ),
  file: (
    <>
      {P(FILE_D)}
      {P('M14 3v5h5')}
    </>
  ),
  filePlus: (
    <>
      {P(FILE_D)}
      {P('M14 3v5h5')}
      {P('M12 11v6M9 14h6')}
    </>
  ),
  fileList: (
    <>
      {P(FILE_D)}
      {P('M14 3v5h5')}
      {P('M9 9h2M9 13h6M9 17h6')}
    </>
  ),
  truck: (
    <>
      {P('M3 6h11v10H3z')}
      {P('M14 9h4l3 3v4h-7')}
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  chart: P('M5 20V10M12 20V4M19 20v-7'),
  box: (
    <>
      {P('M21 8 12 3 3 8v8l9 5 9-5z')}
      {P('M3 8l9 5 9-5M12 13v8')}
    </>
  ),
  tag: (
    <>
      {P('M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z')}
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      {P(
        'M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.7 7.7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.3 1 2-3.4z'
      )}
    </>
  ),
  building: (
    <>
      {P('M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16')}
      {P('M15 10h4a1 1 0 0 1 1 1v10M3 21h18M8 8h3M8 12h3M8 16h3')}
    </>
  ),
  pin: (
    <>
      {P('M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z')}
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {P('m3 7 9 6 9-6')}
    </>
  ),
  phone: P(
    'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'
  ),
  printer: (
    <>
      {P('M7 9V3h10v6')}
      {P(
        'M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2'
      )}
      {P('M7 14h10v7H7z')}
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      {P('M8 3v4M16 3v4M3 10h18')}
    </>
  ),
  down: P('m6 9 6 6 6-6'),
  up: P('m6 15 6-6 6 6'),
  right: P('m9 6 6 6-6 6'),
  left: P('m15 6-6 6 6 6'),
  coins: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      {P(
        'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'
      )}
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 11v5M12 8h.01')}
    </>
  ),
  trash: <>{P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6')}</>,
  plus: P('M12 5v14M5 12h14'),
  edit: (
    <>
      {P('M4 20h4L19 9l-4-4L4 16z')}
      {P('M13.5 6.5l4 4')}
    </>
  ),
  percent: (
    <>
      {P('M19 5 5 19')}
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  receipt: (
    <>
      {P('M6 3h12v18l-3-2-3 2-3-2-3 2z')}
      {P('M9 8h6M9 12h6')}
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {P('M3 10h18M7 15h4')}
    </>
  ),
  logout: (
    <>
      {P('M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4')}
      {P('M16 8l4 4-4 4M20 12H9')}
    </>
  ),
  check: P('m5 12 5 5 9-10'),
  palette: (
    <>
      {P(
        'M12 3a9 9 0 1 0 0 18c1.5 0 2.1-1 1.6-2.1-.4-1.1.3-2.1 1.5-2.1H17a4 4 0 0 0 4-4c0-5-4-9.8-9-9.8z'
      )}
      <circle cx="7.6" cy="11.4" r="1.1" />
      <circle cx="10.6" cy="7.4" r="1.1" />
      <circle cx="15.2" cy="7.8" r="1.1" />
    </>
  ),
  eye: (
    <>
      {P('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z')}
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      {P(
        'M3 3l18 18M10.6 5.2A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.7C3.8 8.5 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2'
      )}
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      {P('M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5')}
    </>
  ),
  x: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('m9 9 6 6M15 9l-6 6')}
    </>
  ),
  pie: (
    <>
      <circle cx="12" cy="12" r="9" />
      {P('M12 3v9h9')}
    </>
  ),
  hourglass: (
    <>
      {P('M6 3h12M6 21h12')}
      {P('M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9')}
    </>
  ),
  download: (
    <>
      {P('M12 4v11M7.5 11 12 15.5 16.5 11')}
      {P('M5 20h14')}
    </>
  ),
  filter: P('M4 5h16l-6 8v6l-4-2v-4z'),
  reset: (
    <>
      {P('M4 12a8 8 0 1 0 2.6-5.9')}
      {P('M4 4v4.5h4.5')}
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
};
function Ic({ n, s = 20 }: { n: string; s?: number }) {
  return (
    <svg
      className="ic"
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {IC[n]}
    </svg>
  );
}
function Card({
  ic,
  title,
  children,
  cls,
}: {
  ic?: string;
  title?: string;
  children: ReactNode;
  cls?: string;
}) {
  return (
    <div className={'card' + (cls ? ' ' + cls : '')}>
      {title && (
        <h2>
          {ic && <Ic n={ic} s={22} />}
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}
/** input dengan ikon di kiri */
function IF({ ic, children }: { ic: string; children: ReactNode }) {
  return (
    <div className="ifld">
      <span className="ico">
        <Ic n={ic} s={18} />
      </span>
      {children}
    </div>
  );
}
/** logo sidebar: gambar unggahan admin (Pengaturan). Bila belum ada, pakai logo PT Argapura di kotak putih. */
function SideLogo({ src, box }: { src: string; box?: boolean }) {
  const img = <img src={src || LOGO_TIGHT} alt="Logo PT Argapura" />;
  return box ?? true ? <div className="logoph">{img}</div> : img;
}

/* ================= LOGIN / DAFTAR ================= */
/** Latar sidebar: partikel melayang yang saling terhubung garis tipis bila berdekatan (efek jaringan/konstelasi).
 *  Garis juga menyambung ke kursor saat mouse berada di sidebar. Berhenti otomatis saat tab/drawer tidak terlihat. */
function SideFx() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const host = cv?.parentElement;
    const ctx = cv?.getContext('2d');
    if (!cv || !host || !ctx) return;
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches;
    type Pt = { x: number; y: number; vx: number; vy: number; r: number };
    let w = 0,
      h = 0,
      pts: Pt[] = [],
      raf = 0,
      tick = 0,
      off = false;
    const mouse = { x: -999, y: -999, on: false };
    const LINK = 105,
      MLINK = 140;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      if (!still)
        for (const p of pts) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) {
            p.vx *= -1;
            p.x = Math.min(w, Math.max(0, p.x));
          }
          if (p.y < 0 || p.y > h) {
            p.vy *= -1;
            p.y = Math.min(h, Math.max(0, p.y));
          }
        }
      ctx.lineWidth = 1;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j],
            d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(170,235,255,${(
              (1 - d / LINK) *
              0.5
            ).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        if (mouse.on) {
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (d < MLINK) {
            ctx.strokeStyle = `rgba(255,255,255,${(
              (1 - d / MLINK) *
              0.75
            ).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }
      for (const p of pts) {
        ctx.fillStyle = 'rgba(150,230,255,.18)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = 'rgba(225,248,255,.9)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
    };
    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const nw = host.clientWidth,
        nh = host.clientHeight;
      if (!nw || !nh) return;
      const ow = w,
        oh = h;
      w = nw;
      h = nh;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(14, Math.min(44, Math.round((w * h) / 9500)));
      const mk = (): Pt => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: 1 + Math.random() * 1.3,
      });
      if (pts.length && ow && oh) {
        // ukuran berubah (sidebar melebar/menyempit): partikel lama diskalakan, tidak diacak ulang
        for (const p of pts) {
          p.x = (p.x * w) / ow;
          p.y = (p.y * h) / oh;
        }
        while (pts.length > n) pts.pop();
        while (pts.length < n) pts.push(mk());
      } else pts = Array.from({ length: n }, mk);
      draw();
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || still) return;
      if (tick++ % 20 === 0)
        off = getComputedStyle(host).visibility === 'hidden'; // drawer HP tertutup = tidak digambar
      if (!off) draw();
    };
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.on = e.pointerType === 'mouse';
    };
    const leave = () => {
      mouse.on = false;
    };
    build();
    const ro = new ResizeObserver(build);
    ro.observe(host);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);
  return <canvas ref={ref} className="sidefx" aria-hidden="true" />;
}

/** Logo login: video logo diputar sekali -> setelah selesai, video memudar & logo asli (latar putih, unggahan admin) masuk dengan efek transisi
 *  -> ditahan LOGO_HOLD ms -> kembali memutar video dari awal, berulang terus. Ubah LOGO_HOLD untuk mengatur jeda. */
const ADMIN_ONLY = new Set(['all', 'doc', 'users', 'history', 'setting']); // Semua Pengajuan, Dokumen PO, Verifikasi User, Change History, Pengaturan
const IDLE_MS = 2 * 60 * 1000; // batas tanpa aktivitas sebelum auto-logout (2 menit)
const LOGO_HOLD = 3000; // jeda logo tampil (ms) setelah transisi masuk selesai
const LOGO_FADE = 900; // lama transisi (ms), samakan dengan .al-swap di CSS
function LoginLogo({ src, leaving }: { src: string; leaving: boolean }) {
  const vref = useRef<HTMLVideoElement>(null);
  const timer = useRef<number>(0);
  const [phase, setPhase] = useState<'video' | 'logo'>('video');
  useEffect(() => () => clearTimeout(timer.current), []);
  const toLogo = (loopBack: boolean) => {
    setPhase('logo');
    clearTimeout(timer.current);
    if (!loopBack) return;
    timer.current = window.setTimeout(() => {
      setPhase('video');
      const v = vref.current;
      if (v) {
        v.currentTime = 0;
        v.play().catch(() => {});
      } // video diputar ulang saat logo memudar keluar
    }, LOGO_FADE + LOGO_HOLD);
  };
  return (
    <div
      className={
        'logobox alogo videobox' +
        (phase === 'logo' ? ' show-logo' : '') +
        (leaving ? ' burst' : '')
      }
    >
      {/* Video logo: file logo-anim.mp4 harus diletakkan di folder public/ project (diakses sebagai /logo-anim.mp4).
          muted wajib agar browser mengizinkan autoplay. Tanpa "loop": pengulangan diatur manual lewat onEnded. */}
      <div className={'al-swap ' + (phase === 'logo' ? 'is-logo' : 'is-video')}>
        <video
          ref={vref}
          className="al-video"
          src="/logo-anim.mp4"
          autoPlay
          muted
          playsInline
          onEnded={() => toLogo(true)}
          onError={() => toLogo(false)}
        />
        <img className="al-logo" src={src} alt="Logo PT Argapura" />
        <span className="al-sweep" aria-hidden="true" />
      </div>
      <span className="al-ring r1" aria-hidden="true" />
      <span className="al-ring r2" aria-hidden="true" />
      <span className="al-flash" aria-hidden="true" />
    </div>
  );
}

/** Logo login beranimasi (autoplay berulang, tanpa emas): 1) Terangkai cepat — 4 pita atap meluncur bergantian dari kiri/kanan, pilar naik, teks menyusul dari kanan, 2) Shimmer putih kebiruan, 3) Beacon Glow biru neon, 4) Pulse & Flash saat login berhasil (class "burst"). */
// @ts-ignore tidak dipakai (dibiarkan agar tidak mengubah kode lama)
function AnimLogo({ src, burst }: { src: string; burst: boolean }) {
  const custom = !!src; // logo unggahan admin: efek per-bagian (pilar/atap) dimatikan, efek keseluruhan tetap jalan
  const img = src || LOGO_WIDE;
  const mask = {
    WebkitMaskImage: `url("${img}")`,
    maskImage: `url("${img}")`,
  } as CSSProperties;
  return (
    <div
      className={
        'logobox alogo' + (custom ? ' custom' : '') + (burst ? ' burst' : '')
      }
    >
      <span className="al-aura" aria-hidden="true" />
      <div className="al-stage">
        <img className="al-base" src={img} alt="Logo PT Argapura" />
        {!custom && (
          <span className="al-rw" aria-hidden="true">
            <img className="al-roof" src={img} alt="" />
          </span>
        )}
        {!custom && (
          <img className="al-pil" src={img} alt="" aria-hidden="true" />
        )}
        {!custom && (
          <span className="al-rb rb1" aria-hidden="true">
            <img src={img} alt="" />
          </span>
        )}
        {!custom && (
          <span className="al-rb rb2" aria-hidden="true">
            <img src={img} alt="" />
          </span>
        )}
        {!custom && (
          <span className="al-rb rb3" aria-hidden="true">
            <img src={img} alt="" />
          </span>
        )}
        {!custom && (
          <span className="al-rb rb4" aria-hidden="true">
            <img src={img} alt="" />
          </span>
        )}
        <span className="al-shine" style={mask} aria-hidden="true" />
      </div>
      <span className="al-ring r1" aria-hidden="true" />
      <span className="al-ring r2" aria-hidden="true" />
      <span className="al-flash" aria-hidden="true" />
    </div>
  );
}

function Auth({
  users,
  setUsers,
  onLogin,
  brand,
  depts,
  tint,
  sync,
}: {
  sync: SyncStatus;
  tint: boolean;
  depts: string[];
  users: User[];
  setUsers: (f: (u: User[]) => User[]) => void;
  onLogin: (id: string) => void;
  brand: Brand;
}) {
  const [mode, setMode] = useState<'login' | 'daftar'>('login');
  const [f, setF] = useState({
    nama: '',
    username: '',
    email: '',
    pass: '',
    dept: '',
  });
  const [msg, setMsg] = useState('');
  useEffect(() => {
    // tampilkan alasan bila keluar otomatis karena tidak aktif
    try {
      if (sessionStorage.getItem('po_idle')) {
        sessionStorage.removeItem('po_idle');
        setMsg(
          'Anda otomatis keluar karena tidak ada aktivitas selama 2 menit. Silakan masuk kembali.'
        );
      }
    } catch {
      /* abaikan */
    }
  }, []);
  const [show, setShow] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  /* Loading state tombol: "login" = spinner saat autentikasi, "daftar" = progress bar + spinner, lalu centang "Berhasil!" */
  const [busy, setBusy] = useState<'' | 'login' | 'daftar'>('');
  const [prog, setProg] = useState(0);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false); // efek keluar setelah login berhasil: kartu membesar + glow, lalu memudar
  const timers = useRef<number[]>([]);
  const later = (fn: () => void | Promise<void>, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(
    () => () => {
      timers.current.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
    },
    []
  );

  const submit = () => {
    if (busy) return; // cegah klik / Enter berulang selama proses
    const email = f.email.trim().toLowerCase();
    const un = f.username.trim().toLowerCase();
    if (mode === 'login') {
      setMsg('');
      setBusy('login');
      // Tombol disabled + spinner sampai autentikasi selesai
      later(async () => {
        const left = lockLeft(un);
        if (left > 0) {
          setBusy('');
          return setMsg(
            `Terlalu banyak percobaan gagal. Coba lagi ${Math.ceil(left / 60000)} menit lagi.`
          );
        }
        const cand = users.find((x) => uname(x) === un);
        let okPw = false;
        try {
          okPw = !!cand && (await verifyPw(f.pass, cand.pass));
        } catch {
          setBusy('');
          return setMsg('Browser tidak mendukung enkripsi (gunakan HTTPS / browser terbaru).');
        }
        noteFail(un, okPw);
        const u = okPw ? cand : undefined;
        if (!u) {
          setBusy('');
          return setMsg(
            sync === 'offline' || sync === 'loading'
              ? 'Belum terhubung ke Google Sheet, jadi data akun belum bisa dibaca. Periksa internet atau pengaturan Apps Script, lalu coba lagi.'
              : 'Username atau password salah.'
          );
        }
        if (u.status === 'approved') {
          WEAK_LOGIN = PW_WEAK.includes(f.pass.toLowerCase());
          if (!isHashed(u.pass)) {
            const h = await hashPw(f.pass); // upgrade password lama -> hash
            setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, pass: h } : x)));
          }
        }
        if (u.status === 'pending') {
          setBusy('');
          return setMsg('Akun Anda masih menunggu verifikasi admin.');
        }
        if (u.status === 'rejected') {
          setBusy('');
          return setMsg('Akun Anda tidak aktif. Hubungi admin.');
        }
        // Glassmorphic Expansion & Fade-out: kartu membesar (102%) + pendaran biru, lalu melebur sebelum pindah ke dashboard
        setDone(true);
        setLeaving(true);
        const quick = window.matchMedia?.(
          '(prefers-reduced-motion: reduce)'
        ).matches;
        later(() => onLogin(u.id), quick ? 150 : 1050);
      }, 900);
      return;
    }
    if (!f.nama.trim() || !un || !email || f.pass.length < 8 || !f.dept)
      return setMsg('Lengkapi semua isian. Password minimal 8 karakter.');
    if (!/^[a-z0-9._-]{3,20}$/.test(un))
      return setMsg(
        'Username 3-20 karakter: huruf, angka, titik, strip, atau garis bawah (tanpa spasi).'
      );
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setMsg('Format email tidak valid.');
    if (users.some((x) => uname(x) === un))
      return setMsg('Username sudah dipakai. Pilih username lain.');
    if (users.some((x) => x.email.trim().toLowerCase() === email))
      return setMsg('Email sudah terdaftar.');
    if (sync === 'offline' || sync === 'loading')
      return setMsg(
        sync === 'loading'
          ? 'Sedang menghubungkan ke Google Sheet. Tunggu beberapa detik lalu coba lagi.'
          : 'Belum terhubung ke Google Sheet, jadi data akun belum bisa dibaca/dikirim. Periksa internet atau pengaturan Apps Script, lalu coba lagi.'
      );
    setMsg('');
    setBusy('daftar');
    setProg(0);
    // Progress bar terisi kiri → kanan, form diberi overlay shimmer, lalu tombol berubah jadi centang hijau
    const iv = window.setInterval(
      () => setProg((p) => Math.min(100, p + 4 + Math.random() * 6)),
      90
    );
    timers.current.push(iv);
    later(async () => {
      clearInterval(iv);
      setProg(100);
      const ph = await hashPw(f.pass);
      setUsers((l) =>
        l.some((x) => x.email.trim().toLowerCase() === email)
          ? l
          : [
              ...l,
              {
                id: newId('u-'),
                nama: f.nama.trim(),
                username: un,
                email,
                pass: ph,
                dept: f.dept,
                role: 'user',
                status: 'pending',
              },
            ]
      );
      setDone(true);
      later(() => {
        setBusy('');
        setDone(false);
        setProg(0);
        setMode('login');
        setF({ nama: '', username: '', email: '', pass: '', dept: '' });
        setMsg(
          'Pendaftaran terkirim. Tunggu verifikasi admin sebelum bisa masuk.'
        );
      }, 1100);
    }, 1800);
  };

  const sbtn = (kind: 'login' | 'daftar', label: string) => {
    const on = busy === kind;
    return (
      <div className="btntray">
      <button
        type="button"
        className={
          'pri wide sbtn' + (on ? ' loading' : '') + (on && done ? ' ok' : '')
        }
        disabled={!!busy}
        aria-busy={on}
        onClick={submit}
      >
        {kind === 'daftar' && on && (
          <span
            className="pbfill"
            style={{ width: prog + '%' }}
            aria-hidden="true"
          />
        )}
        <span className="sbl">
          {on && done ? (
            <>
              <span className="chk" aria-hidden="true">
                ✓
              </span>
              Berhasil!
            </>
          ) : on ? (
            <>
              <span className="spin" aria-hidden="true" />
              Memproses...{kind === 'daftar' ? ` ${Math.round(prog)}%` : ''}
            </>
          ) : (
            label
          )}
        </span>
        {kind === 'login' && !on && (
          <span className="sarrow" aria-hidden="true">
            <Ic n="right" s={18} />
          </span>
        )}
      </button>
      </div>
    );
  };

  const reg = mode === 'daftar';
  const go = (m: 'login' | 'daftar') => {
    setMode(m);
    setMsg('');
    setShow(false);
    setF({ nama: '', username: '', email: '', pass: '', dept: '' }); // kosongkan isian (hindari autofill browser)
  };

  const userFld = (
    <Field label="Username">
      <div className="fin">
        <span className="fic" aria-hidden="true">
          <Ic n="user" s={19} />
        </span>
        <input
          type="text"
          name={reg ? 'daftar-username' : 'username'}
          autoComplete={reg ? 'off' : 'username'}
          autoCapitalize="none"
          spellCheck={false}
          disabled={!!busy}
          value={f.username}
          onChange={(e) => set('username', e.target.value.replace(/\s/g, ''))}
        />
      </div>
    </Field>
  );
  const email = (
    <Field label="Email (untuk notifikasi)">
      <div className="fin">
        <span className="fic" aria-hidden="true">
          <Ic n="mail" s={19} />
        </span>
        <input
          type="email"
          name="daftar-email"
          autoComplete="off"
          disabled={!!busy}
          value={f.email}
          onChange={(e) => set('email', e.target.value)}
        />
      </div>
    </Field>
  );
  const pass = (
    <Field label="Password">
      <div className="pw">
        <span className="fic" aria-hidden="true">
          <Ic n="lock" s={19} />
        </span>
        <input
          type={show ? 'text' : 'password'}
          name={reg ? 'daftar-password' : 'password'}
          autoComplete={reg ? 'new-password' : 'current-password'}
          disabled={!!busy}
          value={f.pass}
          onChange={(e) => set('pass', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button
          type="button"
          className="eye"
          aria-label={show ? 'Sembunyikan password' : 'Tampilkan password'}
          title={show ? 'Sembunyikan password' : 'Tampilkan password'}
          onClick={() => setShow((x) => !x)}
        >
          <Ic n={show ? 'eyeOff' : 'eye'} s={18} />
        </button>
      </div>
    </Field>
  );
  const head = (side: 'login' | 'daftar') => (
    <>
      <LoginLogo src={brand.logo || LOGO_WIDE} leaving={leaving} />
      <h1>PO Request System</h1>
      <p className="mute">PT Argapura</p>
      <div className="tabs">
        <button
          type="button"
          className={side === 'login' ? 'on' : ''}
          disabled={!!busy}
          onClick={() => go('login')}
        >
          <Ic n="user" s={18} />
          Masuk
        </button>
        <button
          type="button"
          className={side === 'daftar' ? 'on' : ''}
          disabled={!!busy}
          onClick={() => go('daftar')}
        >
          <Ic n="fileList" s={18} />
          Daftar
        </button>
      </div>
    </>
  );

  return (
    <div
      className={
        'auth' + (brand.bg ? ' hasbg' : '') + (leaving ? ' leaving' : '')
      }
      style={
        {
          '--g': (100 - brand.glass) / 50,
          ...(brand.bg
            ? {
                backgroundImage: `url("${brand.bg}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : {}),
        } as CSSProperties
      }
    >
      {brand.bg && tint && <div className="authtint" aria-hidden="true" />}
      {/* Slow Flowing Abstract Waves: pita gelombang biru yang mengalir sangat pelan di belakang kartu */}
      <svg
        className="waves"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="wvA" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a3a9e" stopOpacity=".0" />
            <stop offset=".35" stopColor="#3aa0ff" stopOpacity=".95" />
            <stop offset=".7" stopColor="#7fe3ff" stopOpacity=".9" />
            <stop offset="1" stopColor="#ffffff" stopOpacity=".0" />
          </linearGradient>
          <linearGradient id="wvB" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7fe3ff" stopOpacity=".0" />
            <stop offset=".4" stopColor="#2f8bff" stopOpacity=".9" />
            <stop offset=".8" stopColor="#1a5ff0" stopOpacity=".8" />
            <stop offset="1" stopColor="#0b4fc4" stopOpacity=".0" />
          </linearGradient>
          <linearGradient id="wvC" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity=".0" />
            <stop offset=".5" stopColor="#d6f2ff" stopOpacity=".8" />
            <stop offset="1" stopColor="#3aa0ff" stopOpacity=".0" />
          </linearGradient>
        </defs>
        <g className="wv w1">
          <path
            d="M-300 640 C 0 520, 340 790, 760 650 S 1380 500, 1900 650 L1900 735 C1400 600, 1120 790, 760 735 S 80 590, -300 730 Z"
            fill="url(#wvA)"
          />
          <path
            d="M-300 640 C 0 520, 340 790, 760 650 S 1380 500, 1900 650"
            fill="none"
            stroke="#ffffff"
            strokeOpacity=".4"
            strokeWidth="1.5"
          />
        </g>
        <g className="wv w2">
          <path
            d="M-300 770 C 120 690, 420 880, 820 790 S 1420 680, 1900 790 L1900 880 C1450 760, 1160 930, 820 880 S 160 740, -300 870 Z"
            fill="url(#wvB)"
          />
          <path
            d="M-300 770 C 120 690, 420 880, 820 790 S 1420 680, 1900 790"
            fill="none"
            stroke="#bfeaff"
            strokeOpacity=".35"
            strokeWidth="1.2"
          />
        </g>
        <g className="wv w3">
          <path
            d="M-300 150 C 100 40, 480 260, 880 140 S 1440 20, 1900 150 L1900 215 C1450 95, 1180 290, 880 205 S 150 90, -300 225 Z"
            fill="url(#wvC)"
          />
          <path
            d="M-300 150 C 100 40, 480 260, 880 140 S 1440 20, 1900 150"
            fill="none"
            stroke="#ffffff"
            strokeOpacity=".3"
            strokeWidth="1.2"
          />
        </g>
        <g className="wv w4">
          <path
            d="M-300 400 C 60 300, 380 500, 780 400 S 1360 300, 1900 410 L1900 450 C1400 350, 1140 540, 780 450 S 120 340, -300 450 Z"
            fill="url(#wvA)"
            opacity=".85"
          />
        </g>
      </svg>
      <span className="orb o1" aria-hidden="true" />
      <span className="orb o2" aria-hidden="true" />
      <span className="orb o3" aria-hidden="true" />
      <div
        className={
          'scene' + (reg ? ' flipped' : '') + (leaving ? ' leaving' : '')
        }
      >
        {/* Sisi depan: Masuk */}
        <div
          className={'face f authbox' + (reg ? '' : ' act')}
          aria-hidden={reg}
        >
          <span className="sheen" aria-hidden="true" />
          {head('login')}
          {userFld}
          {pass}
          {!reg && msg && <div className="info">{msg}</div>}
          {sbtn('login', 'Login')}
        </div>

        {/* Sisi belakang: Daftar */}
        <div
          className={
            'face b authbox' +
            (reg ? ' act' : '') +
            (busy === 'daftar' ? ' formbusy' : '')
          }
          aria-hidden={!reg}
        >
          <span className="sheen" aria-hidden="true" />
          {head('daftar')}
          <Field label="Nama lengkap">
            <input
              disabled={!!busy}
              value={f.nama}
              onChange={(e) => set('nama', e.target.value)}
            />
          </Field>
          {userFld}
          {email}
          {pass}
          <Field label="Departemen">
            <select
              disabled={!!busy}
              value={f.dept}
              onChange={(e) => set('dept', e.target.value)}
            >
              <option value="">Pilih departemen</option>
              {depts.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
          {reg && msg && <div className="info">{msg}</div>}
          {sbtn('daftar', 'Kirim pendaftaran')}
        </div>
      </div>
    </div>
  );
}

/* ================= DOKUMEN PO (A4 portrait, siap cetak) ================= */
// Data tetap di dokumen PO. Ubah di sini jika alamat pengiriman / nomor form berubah.
// @ts-ignore tidak dipakai
const LOGO =
  'data:image/png;base64,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';
const LOGO_WIDE =
  'data:image/png;base64,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'; // logo horizontal PT Argapura (dipangkas) untuk halaman login beranimasi
// Versi logo yang sudah dipangkas (tanpa ruang kosong) untuk sidebar & halaman login. LOGO asli tetap dipakai di dokumen PO.
const LOGO_TIGHT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAABgCAYAAADVenpJAAA5I0lEQVR42u19eVzT9/3/65P7JCQECPhJIEAEgoSrCAqUKoVqPVCka0fbrTons8dcj5+169ZjW7fOb9fO2tZJvdqutl3Vqj1msWoVKCpyQ1AQAiFgAiEHuUPI5/cHvNOPFNSuh+3m6/Hg8SB5f47X+/16vs73EYAb9D9N1P/WjoWIxRKX02kPEYslqTfNnR8pCU90ezyjLqfTPtM9c7Oyls7C8dlsDodlMpkMSSpVhn98nLjSPT92wv5bhL2gqKgYAKCjre3c7/ZXntYZrcT8CK4HAOBvtQNcv80M832aAxvvX18KABAhkSSJwsJY7S0t9QAApWVl5Xn3PfT7E73WyDsXpI73H/3gkDQzZy4AQNPJEx//9bEN60vLysoBAPbt3bv9BgCuMyWpVBno/w2/3vAvl0zJvGm2VGBk8blPv38OixHziPW3q7DjLf3EvjNa7LY5EkL/5p/XI+G9U9eiBQDY/9Lzz+3bu3d7iFgseaW2rX/jwTZaOh5EbFyeAu9UdcGnbXpsXY50bH4E1/PFJQcTAIBoPH544/3rS0vLysqb6upqL3Z1tfxYx5H2Y2O4tKysvGhhwUaXTMkMk8vDOXw2dffhWoBeK0SrlKAzOcA6zoRIIRecLi+h1lmAx2FClIDuO9HWdg49Y8jsoJwcoUQuWliwcd/evdtHjEZ99VvbN2cmLnpCY/Zg2kGzL1Emon7apofaXgttviqaVl07COqBUWzNLUtKanp1tnOd/dash0Rh23+29KYfKwhoPxahx6ZnpYZwGKHSzJy571904T0X7NizKjah1lmh3cbGkiNZhJjPgl0nLgDN54ZEmQgAALRmDyYTMgmc5tEjc//wnze/sLl2kKs1ezBrWq40TqFQXezqauEFBYsihVxoHbBBi36Umq0IBx6HCRqzFzPa3ERRCg7qATXUdV0CJZ7APT5C5fZd0GHlb350zlhzZGdsMK+otqb62OEPP3xqxGjU/xjGlvJjEH7WQ09vvRAUXx5fUlZi4orx1gEbFiXmExw2A6vrugQAAJmKCDDa3KA1ezAehwmzZwmxo039YHd6QCrkwP6Xnn8OPVM7bDJrzR7M4sXA5MNoqZmZ8wAAdjz/x2dzYsXjgNHhgs4MAAA5MULC6PDA0aZ+wEVc4DIx6DHaMQAAJR4M1nEm9FnHaMvX/6r8E/8subXoV2tf+ffxs3EKheoGAL6B0LdU1ureqWvRrnr2xVfePqejE3wRiPksqGzWgZsAKErBwenyEhqzF+MyfKDEBXC6ywBGhwdyYoSE0+Ul+s1O4HGYUJgqDTz78Re2bKsZoeAW70T4o9ZZIO++h34PADBiNOr7j35wSBnJJjRmL6YzOSBRJgIWhQ79ZieI+SyIEvOJETcBap0VshXhIKB6oLrLgBltbshKV0LrgA1rcbPwdQ8/8lTFjp3dj7+wZdsNAHwN2vzatn1ZDz299USvNVKmjMdruo1Uh4cAqZAT0HAxlwm4iAunuwxgd3ogVxFOcNgMTK2zAAsDyIkVjzttrnFk/ntb1IMo+EvNX7CkpseMBTOIgIvw8kVhebcWFgEAnK2uOqrEg8Ho8IBuxA64iAvJkSxCa/ZgRpsbilJwYGEAp7smLHyUmE84PAToTA5Q4gIAjA5HWg1Yzs/XlFiTcqVds7LL36lr0aIM4gYAriJ8bUxeSUVNPz0xMQaMNjfU9JgxpMU6kwOMDg/IhExCzGcBCvASZSIwDll9WrMHU84KImSRQmpNt5Fqd3ogN1rg27f5qTXIspi4Ytzo8IBcyCDuypKC3eWHPusY7d677tqGUjwVy60Tc5lwpNWAAQDE40KwO790A8mz+ITW7MEAALIVEvDRJiyTmM8CZSSbsDs90NQ3ArhYgGnMXuzdi248Nj0r9QYAZjD379S1aN+pa9Hm3L7stuouw+TAhoPO5AC7yw8yIZMAAKhs1gGNzoKiFByMNjf0GW1YFM1B4CIutBg9NIsXA2V0OOb0+bGPz1swHocJgvbq/qrPjlYCAMzNzStEzyhIkUK2PJjgMnxQ3WXAwpeWypGWVr720hG5cMJE6EwOUEmCxnkcZsANRAq5YHR44HSXAZS4AIIZBPQZbZjR5obcaIEPMDp0aE3A4bOpMiGT0Jo9WGrxnWtRPze/tm3fDQCQArz3GgdxCA6LaHJSuCNuApSzgggxnwXHmvsBiLGJQZ0018EMAmbPEmKnuwww4iYgMTEGOGwGdqFXTwioHsiWBxOdA2YCAEAmZBIWr7cRACBOoVDFl5SVaM0eLC2cTgAAOPv7dLmKcMLhpYFaZw3wZfN46udFB/vsTg90aE0gixRSZUIm0aAbxYw2NxSmSiGEhYFaZwkEiiPuCTcwWy6h8dgUqOkxBwJFu9MD75/ro8qU8fh7jYO4Niav5IcCgusKgFXPvvhKRU0/HQCAw2dTO7QmQGbVaHODxuydiOjlElqnRu+zOycCPA6NQqh1FhBzmaCSBI13DpgJjdmLRYn5BAoUfWMT2vjGP7b9BQBg3cOPPKXWWcHo8EA8LgTdiB3evejG+QI+xmNT4HSXHh7+8+YXkBvAaR49j8OEmh4zZrS5IVshAQCAo039Ad+P3ECiTAQ0+pduQCZkEnanBzo1eh85lQQAwGU4fNqmx7C0hct/CHHBdQPA5te27Xv/XB/VTUBAi6u7DFgICwMlLgCdyQEWLzYhcDYDq+610gCjQ2GqFIw2N6gHRjG5kEEg4Fi8GCjx4MsCRWPNkZ0o9weYCNzEXCbgITxQ6yzQZ7RhuIBOyIRMos9ow7RjNFaIWCxB18uFDMLu8kOnRu9T4gIIYWFQ02PGOGwGJhVyAnHB7FlCLJhBADlQBADos47RECAsXgyQ9QAAqO210FD28T8JgJzbl902DhiIuUzIVoRD54CZcHhpQNZiVNBxuryE1uzBlJFsgsNmYEeb+sFHY0GmIgIAAGp6zJiA6gnEDRYvBjIhk9i//ZVtqGwsLVxZjHJ/XMSFohQcflmQSOAiLiijwzHrOBNquo3UtZt+/zQAwGtPPLo2P8Q/CMQY1PZaaCgFNDo80DlgJgpTpcBlYtBvdoLT5SVQvUCtswIu4gLZehSl4EDzueGNE+cnAsVZQQSyCP+TAIhTKFTaMRpLPejCZEImwWEzMGT+UYBHLuig/F4q5AQEHswgIFrAGEe+O0bMIzhsBoaAU5SCA5PNpgMA/PxX659o0Y9SLV4MghkE7DpxASqbdVDZrINdJy7AkUYtAAD0m52wvHTVPSFisaTqs6OVbK3aQ6oEQrZCAiwMAPEaJeYTfUYb5rS5xnNixeMsCn3CyvBZkBMjDLgBBAiN2Ys5fX5MiQeDxYtBl58fuXr16or/GQAkqVQZpWVl5W8cPVHz/rk+qo9KhWyFBJwuL1HdZcB4bArgIi50avQ+ckEH+fucWPF454CZsDsnU8EwAa2u6xJYvBhkKiICloLHYYLIYdTpBwcH0LvVOguQc3/yHwBAMIMAzGYCI4vPRfdYvN5GsiCVuCCg2eRKYE23kSqLFFKTI1kTrmTQPJ4oEwGPw4TqXmvADSDrka0Ih2AGATU9ZmzFX/6+dvNr2/Zdr8rh9zIXkHdrYdH9f/nbDggOi2jRj1I31w6C1uzFghkASlwAap0VRtwEZOIMQsxnwe5WDY2F0SbM/0RBhyYTMgkOn02taeoHNwEB4GjMXkxA9QaeY3R4oDhZQjSdPPYxqse/8Y9tf1n6s18MJ1wDr2898mYTuu/DAwcq7nq5uKSmxwzVvVbafFU0yIRMQj0wiulMDshWhMORVgPU9JixwlQ3ESnkQp3uy3kEBDY0j9CgU0Nlsw42Lk8JPOeZAy1YTkxeSfmbC5fjNI9+/0vPP2cYGtag1PVHD4B36lq0NSMU/N2LTtCauzBi3AsYlQFyIYOYFx3sE/NZtNNdFyCEhUFBykSA1z5KC5j/Q7XdVLvTA9IYYcD8o0BRrbOC3eWH25ImKoGnu/QEqgT+aePOHYiH9paW+vbHNtR/Xd6rPjtauezzQwcs3uRVQBKkekANHVoT4CIuoDxfZ3JAYaoUPm0fgXfrh7CFKinkxAiJT9v02OkuA2QrwkHMZaJ6AXHXTbLxGqGRWtNjxmp6zFj1uJeOURnSnJ/9dtuqWPF4+NOPPPh9rDv4TgGw+bVt+9696Mb7jDYMozIgJ0ZIJMpEgIsmrKzO5KC9U9UFWrMHw6iMQHnXTQDcNmH+v1IJtDs9gTrB6a4LwGNTAoFin9GGKWcFEbaTH2tR9J+kUmUkzplz09fhe0A3qKk99XklKg3ftb6gZN8ZbUCQyA0UpkqJbIUE1Cc1cKy5Hx5dngrKSDbRZ7RhnQNmIlEmgpoeM6h1FliaHgUyIZNoMWDYrhMXoCgFpxamSqEwVUpMZCgGUOssUN1lwHRaHTXnoae3fh9rDb5TADDjUrNz+QJfUQpOmz1LiDldXtCZHHC0qR8GzQ7QmL2Y3ekBHocJi5LDA+VdFgZQmCoFp801Tox7aSjAO9Z8nvDRWJcFigAQiBscHoIuFXKg8sNjm1GwueHXG/7VgmfJv5bLotgGe3+28rZLen17R1vbuVWSoPF9ADQkSLmQQTQaxjC1zgpKXAA8NiUwZZwbLfCpB0bpuhE7LFRJMWQhjDY3sWZBPLxx4jyhMXuwHZ93B4pIUQK6L1shoU26DaJTo/cBAKRmZs770QKgtKysfHKFDq1To/cd0ppoKHiyOz2QPItPTLUIpzoMoB50YcmzJlLBd5r6qQ4PAfOig31Ol5emmYwbkKWweDFYkhBMoLwaYML8P1hZeQgN4MfcZHlDqx5jYQBc5uWZl8MzERSi7zEqAyxeDARUz6xn//Tc4Sc2PZ7T3tJS33TovR3KWfPK1QOjmNHmJgpSpND67y443aUHJS4AuZBBtA66sUAlsHEIjrQasIUqKSjxYGjQaeFoUz8Upkph/e0qrHPATOisY5i610DU9JixT50eOq9xCGRCJiEVcqAwVUoDACBy8wq/azfwnQCgYsfO7hY8Sz4R7Hkwu8tP5zJ8ECXmE8rocEwlZvrEYQKa0+UlkEWo6TFjdpcfgBiDTIX8somg2XIJTa2zXmb+1ToL0MbHIVEmAp1pwpooZwUR/Uc/ODRiNOrn3XxLUdZDT2/d2ziE0egs+E1RDCGiU8Zn4pnDZ1MBAN44cR7qdG7MelOudPmyZX/YvXv3uhAOI3RCkKMBQfLYFGSBiIIUKTQaer4S4KGI/99N/fDxeQtW02MGmZBJZCskkC0PJpaqJGC0uQmdyQGVzTrQmj2YemAU0HXSmLySd+patGjZ2o8CAO/UtWjfv+jCW9v0E6nSrCAie64ElLgAxHwW6jD13U9aCa3Zg9mdHkDXSWM4kBMrHpdFCqlNfSNg8WKA6vanu/TA4zAD5l896MKSI1kELuLC0ab+iaqhkANnP6w6CgAwC4+U91nHaHanB5bMkRDaT97f/sBjG9ZPxzN5Uekdz774SutAG62610rLyZwrgt274Wx11dFVhSuLWRjQBs0O4LAZWE6MkPj4vCUQF5AmhAJuoENrgtSoEHh8UZKv1+qlnu7SQ5/RhqkHXcBjUwIanxMrHn/w9uSAQpDBoAvy4Xc+++Ir3xUAvtVl4XEKhWrhqjvL1CZfUFleHJRmRUOhCgez0wNqnRkO1vXBocZB7JRajw3bPFhcGJfIV8mwNfmxRKEKhwgRFwwOL+XNU11w4vww5vN4YIUq3Bci5FEONQ5iAADL06VwtKkfLpi82C0JYsBDeFDdcQlcbheWFyP0bflN+QoAgN9s+M2/dg3yREEsKhSE+AZfevhXd8+0vNvldNrVra316tbW+qzE2BR3mDyxz2jDbr/t5tnYyODQvr17t8dFSSOxWXEZ9TobliMV+GQiDlHfN0LxjvkgTS6GMY8XOi7ZsWg+1TdbLqF9cXEEazV4sIsDRvBTMEqaPAQKVThkxYWBEueD2eqAPrMX6xiwYic6zRSN3kQ09o5ArCQI8pURcEtiOOTKReNWP43Cshr0vHGXQ93aWv+DtgCpmZnzZMp4/FElQFPfyGWm3e0fAxaGLELUZRZBrbPC6a4LEzmzwxO4ThojhPkRXM9HXQaa3emB2+ZICDGfBf1mJwioHlBJgsZ1JgdVY/ZiMWIeoa54fg+KP/gpmfTgOivIhEyCrW31LF+27A9Oh32N3eGYsfhVvHKVpvL4sc3K9QUlDbpRaNGPUg1DwxrUnq2QgHpgFGq6jdTCVGkgBQQAIlEmgkOt+kC9oCwtbKy610pTD4xiDbpRONJqALmQQcTjQsBDePDo8tSA+e/QmqC6y4A5PAQ06NQg5jJBJmQSKFMQ81mRbO3E4tVvGwDfWj0aFXtqRih4TY8Zszs94CYAWBjAbXMkgWBPzGdBU98I6EbscEFnnoieSUJX4sETOfMEOECts0JFtRYLZhDwTImKAAB47J91mHLWl0u3Pz5vwdblyoj6Fzet37d37/bHX9iyzTGnoBwt6T6z9dmH+ExmRkdby9pbFhT42Bym73IL4KFpejUUAID3/vU+7Z26Fu3mOqsUAOC+ONrAhqJ5eIhYLNnV1j34zIEWzOLFoGJ1Bhxv6SferR/CliQEEz/NU8CDb5zFAAAWJYcT5D4gIX866RYBowOPTYGcGCGRE+LXiWcrpAAATpeXONrUHwCDmwAyGMDx+aHAvoYfHADeqWvRvtc4iLeP0jAuE4NcRTiRE+LXcaRROBJ6h9YECBwo+o4R84iCFGkAHEabGzo1el91r5U2GUBOxAiRbGLjvEjHO+ctXCRwJS6Ap98/h2FUBmzMFPQ/uHjh3BGjUX9Ib/U/c6AFAwBYz+js2fF6xQZ5lOwgEvB0/K9evbqi7vQXv8zMnv96WFLqeNes7PLWQTf2YDJjYN/mp9ZUfXa0srSsrHxs2W+2tRi82GNFMQQu4sIzB1owmZBJPHh7Mnaotpv4tE2PIcEhMOAhPEiNCgGnz48Zh6y+mu6JAhB5HKLEfCI3WuCbLZfQOGwG5nR5CVQbUA+MYgAAL9yTSTyad1Pqt5kafqsuICdZ7ls92QEAwM51DeMDyA04PQHkky0Ch83AOgfMBLk2YPFidAHVAzFiHhGfLCRbBG5NjyZQQtaZHIFcev9Lf35uxGjUl5aVlaOC0W1zJISlx9uYpFQu773Y1Rsdpzg+Y9WvuvqV+NmKtSwGfU13w5kH5uUs8rUO6uldfn5keFioHGBi19F9Dwl86oF++tRKYOeAmfhpngKK58VC54CZQGDfd/YSBgDAY3ejnJ8onheLFc+b0PjTXQa4oDND68Ao1mLw0oMn08HcaIEvWyGhLU2PAqPNTXRq9D5nf5/+BxkDxCkUKlmoSMhh8WmTHSI0Zi9md/kxHpsCxLgXSrNkBB7Cg9mzhBgAYE1q7dhRrYlW3WUAh4fAfDQWBDOIQLUQXUfWhD6jDbOOM0EVPjFncLSpHxxeGkQJ6L7mSV+Nln0BAOSE+HX736w66hwxrg+LiIi2eTwzBlFms3koPy/PdbKqis0WBANO8+h5bIq0pseMbXx405MnKisPtbe01OM0j57LxKSoEpgbLfBVDOrpOz7vxgC6A/wjIZPB8Gn7CAYAgZwfCRkVgFA/tWYP9pphOACGCbcooYn5LPzbLg59KwAof/Ojc5trB2nqQRcGxBjwOMyJWn9aMNmkQadG73ulWUebTP/oAAA8DhNum/Ol0J0uLwAAHKrtJgbNDugx2jGHh/iKmQzUCdgUELRX96ubGltCxGKJNDNnrrbOivE4TOivqzkLAIDRaCoOl7dj9+7dMwZRI0aj/mxL6yMjQ4ZtiWHhGciyfNqmx3Q+pmRBUVHxvr17t+9/6fnnYpZt2NZoGMNOayzYUlU0jSPgfynkNj32afvIZT6+MDUKL54XC8Yhq69FP0q9oDNDj9GGqQdGpxaAYKFKigEANKm1Y7W9FprG7MEadFo40moAYtwLuT/77bZS+Pb2J37jGKC0rKzcd8vPtvV66FiUmE9kKyZy/ql+DOX8CBwoGp4U+mXRMKrS8TjMqRYhECj1m53QYvBiSxKCCVlP1YGN968vffyFLduCb1lZ/tqJTqw4WUI43vvbDhaDnq3V6eYMG0eWnz1z5qOr9Wd9+TofAMCwzf7Agt+9sO31Yx1YlJhP3BXH0v00UyVD6xgravrpZP6mC3CnghcFuGhsLot1yPWQSTAAQMBFdmhNMGh2gN9mhjvTInU/zVTJfhAWYG5uXqF0Qeo4qqQBTKyb6zc7iT6jDUOClAmZRNEtsV8J9l5p1tHQdeQBIJeInTbX+KHabmq/2TkREE3GEqpwJpET4tf9/qEX/wAAEMJhhNZ06QN7A/Z7PPVDQ4a1Mhxv+/jjTz66lv64vWO7Otpa1ibOUWWIHEZdlJiPa80eDIJlEXEKhWrf3r3b5+bmFd42J6+k3+yET9tHsE/b9AEhF6XgkK0Ih4Uq6VcUQD0wocnkkm+qUhZQgGPN/aCZLAB92j4CyZEsIlLIJRJlIphMB0GrvqD7QWUB79S1aE1cMX6suR/GAYOvCD0FDwR7xiGrr8Xooal7DYEqIFk7VJKgcXKJGFXEUACpjGQHKmdNh97b0d1wpulEZeWhEaNRH6dQqP64d/9Hm+usUpmQSSQM1G4fam+iDg0Z1oaFhe/YvXv3umsCdFbW0lBxyGEZjrfJU9I6zckFJfvOXsJuSwohuG3Htv91sppYWlZWPjc3r1BauLJYZ7QSKOdHbg357iv1CfWdDHiyxvebnaiUDqiUnq2QQLSAMb7/W5ou/kYA2Pzatn2nheklrQM2DAAgKchH4DJ8xs6oB0YxNPGCtAVdN7Hyxwqnu/QwNf1DQu8/+sGhs9VVR6dOkyJhmJMLSt6tH8LuypKCsPGT/ZrmxtlupzOpvbOreKr5j5BIkgTBwfHnz58/MLVfmzZu9La2t9HCwsJ3KNdtum9v4xBdJmQSd90k+8rAxykUqtTMzHlzc/MK40vKSqamsEhwSMhTXV6/2QnqQRcGAJAcySLGAYOp44JcHgJYUpCP+LbcwDcGADMuNbvLz48k779DgmwxeDGazw1IK8j+EoEDzYpN5wYKU6XwxT/3bA/hMELf+Me2v5BX+KIl1Xn3PfR7L18URvalL9yTSRx84jc7rqT9q1evrmAx6Nn/2n+gaOpO3tKysnKX1bItLCx8R2LmXFGNMKOkxeDFghkELEoOJ1Qstw5tNiWDIUmlyhCFhYfMX7R0ZWr+giU6H1PSZx2jTU2DrxTXTLUi2QoJBHFoAeB0avS+PusYLSfE/8MAQM7P15Sgil1Ae6d0NidWPM7hs6kBoY/Y4d36IUxA9QSelasIJ6IEdJ+x5shOAIAvjnz0gbqpsWU64ax69sVXTGN+KrmwhAYsN1rgO7P12YdC+bwHtDrdnO7untLptHz1vfeMD5lM2Ezt68vXtZjMZiWHy9tV9Nu/rCYXb8jvQsu4OtrazpEBipaXLygqKi5aWLCRn79EFnjG5KwnCogzFRHTBs5kpUiexQ8EzqlRIQDDw46caJx/XQFwSG/17zpx4bII/8u8NfwrFoFs2sngAMvQpaaTJz7ev/2VbdPluKVlZeWrHt70JABAzQgFHzQ7oHXQHTCb8fhEsejCgb0HRpze4RAOI/Tkxx+WyHC8bSYN13Vd2Ga327HM7Pmvz2QhhoYMa4tXrtJ0W+yVKMjE0hYuJ1sbZNmiBHQf0Xj88NnqqqMoLplaKp+/aOlKAID599xXPl12RB47cqYwnRUpSwsb21N+xzwy6L53AKyoOOLv9dCxGDGPmBcdPG0ZkxwUovRPJQkK+HOYIactLSsrD4+Ll+UuW3lvi5uFq3WWgK9E4ClMlYKzv0+H8v1gBiOtse5M1Hm1ujc6OloONPrO6YT7zO9/53zrjTeoAAA35+fTposRbsm/uTw7K3tr7dlzdElYyHhGerqn40Ln22FJqePdDWeaVj286ckWNws/0mq4TKPJoL7SPD469GL+PfeVT00HuUwMyEvokKtA8VR1lwGLZo4Rwtr3rjm4/U4A8E5di1amjMedPn8gWEHFmxE3AWIuM7D4c7ZcQnP29+mmM5comFpV/uB6AIDlpavu+eKSg0lGPjnNSo0KgZd+uXo9SkNNvZrlre1tNOfoaM/iJUsiICj43/ve2LNnqlDR8TK7tr8mHzYMjQEAsLkcxh13/sTV2tn98FRhRUgkSYsWL94wLye34NAH++UjQwZIS8/wp2Vm9VUen1h2turhTU9ypFH4UXLJe0ocY/hon6bbYq/sbjjTNPUd5LUID/958wunjH7uZa50Svw0e5YQ49AohNHmhoNP/Ob6A4A8+0cOXopScEjl+B0v/XbjY1fScqQFpPpBIBBCvi9TEQHRhEW3/6Xnn2uqq6tNzcycV7SwYGNj3ZmoxoZ6SpQ8xp+Rnu4529L6yHQLKSMkkqRn//Tc4WOVR6LOnT49zuZyGHk3548DADQ21FOGDUNjCcnJdDQdPBOvfCYzg8Wgr5n6zn17924vLSsrf/j13dua+kagsll3mf+eGgBfOLD3wNnqqqPTvQcBYtXDm540ccX4lSbQ1O++/pdX//D0k9fVBaAl3KiDIodx2ggZafm6hx95asTpHZ7O9E2NfqMFjMtSv5IVxU9yuexlZ+vqWW6H3Zo5N5sbMzu+fyahzc3KWnrLzXn32kZHV1WdOkkFAEhKVo3Lo+X+z08co9ntduzrAiFOoVDl5eY+iKwCAIAMxwNWoamurnZV+YPrU4vvXKszWok+6xht0OwAlCpPtQ69LepBz8Wm09MBAq1ojk3PSk0tvnNtr9VLreu6BK0DNiwpyEf8v6I53zgQ/EYA+L/aC14AgPkRXM9Lv9342NQNDQjNqAOmMT8VFYyQlpOLIVEC+sRqmn/u2Y6KPLGxsTchITY21FNCwsIhPy/PhTRvJv8ayuc9YDKble2tLVQej0ckJiQS4RGR463tbbS+nm6Mx+MRIWHhgP5PS8/wAwCcV6t7h43DsVExsURy0hyfYXh4z0xmFgGsr69v1dClS71hERHRBUWL+hB4UKr68J83v6AdNpl7sWB8OvOOAK/EBYFAdsfzf3wWzVFMdRWrHt70pM7HlKDj6q4bAPJuLSyaKnBJZOSsn/9q/RMjTu9wavGda2u6jdRARYvkH6lAQEGKFEQOo66/ruYs0nKHzTZ+7733PDVsHLGyGPQ1Wp2Ognyv2zu260oncJFNPRJ8WnqGXyAI9tedPe3o7dFwZFFR/QlKZbTb6cScHg8hj5b7ESgAAPJuzh9H1xsMhuBQcWj34iVLIvZ9cPDOmeYS4hQKlXRWZMott9y8/dTnJz0sLk8gw/G2ydLyaZvHU6/t7h6QxcbOQgKE4LAINDZ9Rhvm8NIAiLHLx4ZOCVjAqZkFOtnsupeCyZUwaeHKYtOYnzq1hIsWQOZGC3y4WIChCBkAoKmurjYvN/dBAAAWg77GZDZDn6aHEhIWDoTP1xIeOevs2fr67VdKd+ZmZS1NUiqXOx32NSTBtwkEwQlTNR4AAlrPZrF7ho3DseHh4RZxWDjf7nBQploErU5H6evpxqJiYgkZjrcN2+yvTpfmkZUgVCyevyD/5mf6env9LqeTFxYRES0SCsHtHdsFAHC+W7NvFh4pD4ABAJC/J7uL6dzhiNM7PFO6fF0KQVjawuVT/RzZrOfEiseHNBoD8nMAAHwmM2NS4Nkms1mJ1ukRPl9LVHQ05cTJU89YLZYLl/T69pnejUwiKvj09XRjoeLQ7gSlMnqqKZfhuN9kNkN7awsVablcLvcAAJhMZjqKB6ZeS3Ydml4NhWxV3N6xXUf+/e8tV+IRACAhIaFk3rx5i1gMenZfb6/fZBpRRclj/GRAtKvVh5F1QIqEpo01Zi9GjHuBPL+SrZBASNPRGeOU7w0AJe+c8bcO2DAehxlYmRMloPsYNtNQmJDrR6YdCR1NzQIA8Lhcv81qbYuKjqbUNzX/1mQyaa8V1XEKhapw4YJ/kgWfNW++jMVk+OoaGljnW1vHQsPD6IkJiYTT4yFmsgoAADOBJkwkIoZMJoxsEeRyuedkVRUbfXfLggLfwcOH7xo2Gr+41oMhExISSpYvW3pnW0tLPEajqdBYAABwuLxdABNH1ATc7H0P/T5MLg+v6TZSybupvq35gG8EgC2VtTovXxSG0zx6W3PdWOXxY5v5TGZGu1p9OEmpXI58OOqkSChUu71jp2tra48AAExXgr3aTF1Gasqfp9P4zgvnbQaDIRhpMTLdZI2vb2hgtre2UF0Op/crgklOpufn5bmcDgd28vPPB5FrmB2fwCdbBBRTkF1LWnpGm9s7dvpaLMJ0E1IAADFRsqeioqPnoPGS4bgfANRu79hpBAp0RK6XLwpj2ExDVXu2/vG6WgDk/9saGoaRmdPqdHN4XK7f7nBQwsLCdwAA1NbWHvGNj1/8T/wW2dR3XjgvRULOz8tzmUxm+pnaL7QzCSsxIZFgcTgE+m46wU+l6Bi5c3Z8Av9a3YhGo+muOnUymcfjEVHyGD+Hy9tVVV39yn/S1ziFQuWw2cYXLV68gcWgZwOAcioghm32V9H1P4jp4PrPj69Ag+JyOL1sLoeReVOmn8XhEH29vW3flEG+QDBn6NKlgCAy09Pdbo+XhjQwPDzcIpPKgpC5BgBYuqx4TCQSjiFzfS2Cn0qh4WH0WxYU+JBbQdqemJA4rWtA1gUBwWa1fuO+R0VHz3E7nVjH+Q6MXLnk8XjEmvL7NevW/iL2uq8IsjscFB6PRwAA8Hg8ut1uh1MnT/omBzFw6oXdbscQQHg8HvE1PlOTklXRP/356h6LcUhysqqKPTJkgJCwcLjjzp+49JcM/PNqtWZSK6PTMrP6GuvORH304SEOeh75mYjXq9GwYWjsow8PMZKSVZT8vDyXKWkOvbW9jdZxvgNLTEgkMtPT3YahIUZjQz1Fq9Oxk5Pm+AqKFvWh6uSwYShxur6h51/pM7pHq+0LfB8aHkb/Ovx/LxYgRCyWLF+27A+h4hAB+ftTn5+4IyQsHJKUyvfRdxwWa9m+fe+zM7Pnvx4qDhGIQ0KWvvnGHk7ezfmt/KCgDgpGWfnRh4foqD0uPvGml/+2OSbv5vzWo8dP3LPx8U0fHKs8EiUSCtX8oKCOuPjEm8ifxfJYqqlXsxwAwE/4P+jr61vVp+mh3HzLgvf/k76R77eNjiYCAKRlZnEvXug4ZxsdTTSZzcqM9HSPcWTkIwAA2+joKrlc7qnYuWteXm7ug3Wnv/hl3s354/ygoP0AAHWnT2ckKJXR/KCg/cPGESu5fdg4Yu1oa1mblp7hR9dPPjOx6tTJ5F8/urHn4oWOc2T+Pj9V9da1rHH83ilOoVAtyMu9uGTJ7X7y9xU7dnbPSYwnIiSSJOQ+5iTGExnpaa+g+fc5ifFEQkJCCZqO/TrtERJJ0pIlt/vv/MkdPgCAO39yh2/Jktv96H1fl26/ragpOzPDn5CQUILehQ50SkhIKJmTGE+sL18X8PNLltzu37Rxo/dq7SFisSRCIkmaqZ3Mb0Z62itzEuOJ7/JQye/kkCiX2xUDN+hHQZQbQ3ADADfoBgBu0HTEZrF7bgDgBn1vxGIyfDcA8D9Mbo+XdgMAN+i/FwBJyapxNPkxldIys7hJyarxIIFg2rJteFhYXFKyasZTvqRRUXIZjvvl0XL/d5HOXundERJJkgzH/TGz4/v/k/YQsVhypfbvkr5zkxMiFkuEQmEYj80SZaSnezLS09+q2LnrIvkadFByRnq6p6Bo0RaTyaRF1UWhIEgcp1CoIqPklzhcrqSgaNH/bf7r8xenDvDaX67bYjEOeYLFYfrSsrJy8I0FgMHl87/2YVhR0dEUk2kE5s2bt2heTm6BxTjkwaWyO6qqq1+Zyntebu6DaH3B1EOfp7bHxsbeBADgHLUAACintkujouQAAF9nVvGb0Ld+Zn2cQqESBwc1hYSFw8cff0IpLSsrj8PxregMHgAAkVAIcrnc8+YbezhLlxWPAQBcqZ3NYfrU6vMMcntaZlbfy3/bHMNkc14tKCgItY2OrjKZJ37rr7h4he31f2wb4QQFxRSvXKVprDsThdquhVBNv+rUSeqvH93Y09N5QYr4y0hP9+za88a9NIzYjyad6hsamNPxRp6Gntq+a/trcvJE0mV9T0k7uPH+9aUZ6WmveFzOB3720G/2f9tnAyH61n89fNOfnnu1rvqUcnxsDJYtW7aKimF+Hpeb6nW5KHQaDaPTaBiNTgeLxUILDw2Dcf84xmKxiKntBAEUQVAQNu4fx6hUOobax8bHQSKJ8AtDxKNnamuEixffnjY6asUAIBQjCIwfFAQelwvDAMQhISEEm8lgWywWGkYQGHr+1f74PC4L8Tfm9fIBAND7qTQ6dvuy5VlnamuEs+MT/C6Xm0rmjc1mg8vhCBIEBWE0Oh2YDIbfabfTyH1zORxBbBZrxnaLQe9PVqnSMApWrtcNjMXgeEJ1Tc0ffxQuwKjpHnc5nF6XwwkdHZ12AJjTe7FLGwg6qJQQ/7h/5Ju849zp09Ly+++XAABYrRYKwMTcPZvDsatSUpVuj5cWHhE5DjCx5EsgCPYDAKWvt7dNlZKqvNrz0T0CQTCgd/T29moAAHp7e8FqtTjRtVar5Xxvby8HfR66dOmyPp5Xq6/4rvNq9XRjwqFQKXf09mjGAAAMw8N7fjQu4PsidKoXk815tb6h8UH0XWL87Ltnukej0XTL5fL/aA5do9F0Hzx0+KeX9Pr2hISEEhpG7M+7Ob912/YKFfyIiQb/ZXRg/z72FZrnNDb8Z3sp09IzlDkLF+bu27u3/b9pvH70AIiLi/uV1WavuNjV1TK5gWPdd/Ge03VfAmdB/s3PVJ06Gchyfiy/FP5fB4DM7PmvAwA4bLbx77Vi5x07nZk9/7TbOwaxsbE3jRiNH8ENukE/RqJez5fHKRSqhYsWrcAwDIYNhkvkwg6fxwuz2+3D6Bqv2z22cNGiFejE7DiFQmUymQzonrlZWUvn5ecvmOlE7anXT/08HV/K5OSblMnJN6lbW+tn4nWm4heHw+Gh08njFAoVk8EQ2+324R8aAK5rFvDs088M9/ZcFLE4HEIgCPYfPHz4rkce+3//11h3Jgp9XnPfz99ChRKRUAj1Tc0rMlJT/iwQBCe88eabaTkLF+bG4fhWlA6i3TbzcnILnv7dk8sv6fXtcQqFat0v1tSebWl9BG3xRs9Hy9m3ba9QrV69uuLn9977y7Nnzzg1Gk03ACgFgmC/YXh4T3ho6H1Wq4UiEAT7Y2bH9z+x6fEc5PsTEhJK7rqj9J+ciFmfdNSdNU1ee/7gocM/XbR48Qanw74GFXj++tTvH1y+bNkf5uXkFnwbq3p/1BYgPDz0L7hU5leqUrRZmZni3kuXTvR2dZbJY6K9MnncQGFBwV1n6urepVOwdPPoKIXJYu8MCw2NHx0dLbrYecGekTmXf7Gz85zdYb/7loLCXkVcHHVQ15993++eTThz5BNRc3PzdrvdPiwKCQkHIB4YvnTpk4TZ8b+NjIzwEn4/wRcInAAAo6OjRYkpqQYmjRYZFhYW29zcxBEIgkOUqhStFMdpzR0db1lNI0vZbLbaarN9ZDRcWjCo1//TZDIZnnn6mZ1xsTF/bGxpZris1hqnw76GgmGYyWwOTUtNzW9oaOhhMJlzU1NS3Gfr6raplMq7nQ77GqtpZPBcff226w2A6z4baLg0SLUYhySdPZoeVMZ1OT20xrozDrvLbTry739vYXE47edbW8fI27RvW7SYER2F35OkVC4HAOjpvCBtaW7mAgC0f/bp0HTvmjt37kJVSorDZDLTDUNDF1kMevbkBgyYq0p+kcWgryEVeCgW45DE7nKbyMEf2tWEAs9nnn3mF4bh4T2TGzdAHi33y+VyD4fJxORyeeyjjz52d5hIRJysqmI/vO6X/2Ax6GsKihb1yeXy2CSVKuN/HgAsDqe940Ln27U11ceKFhZsbGlu5i67/9eetMws7rHKI1GisDAWAEB8YmJHnEKhYjHoa0TCid8QVKvPMwpvvfUOHpfrNwwP74mZHd+PdtIAACxavHjD6tWrK0pWFD8JABAXn3gTev5kQUgpEAQn2KzWto2bnuAi9zFJasTXyOCAEwAgCp91z7x58xYBgBrxBQBABqYqJcWBS2VeFodDBIvDJtJDGn2nDMf9fQODFoEg2D/Yp4nQaDTMuRkZ1/3Xw69rGlhQtKjPYhyKBYDYYHGYvvL4sc1zVckv1rz7FsVkMks5XN6u9paW+p//an2n2ztm4oSI56VlZvUh316xY2e33eWGjPR0BgDcbTEOQX5ensvi9TaKREKJSCS8GwAAl8q84pAQD3r+Z3u2U11OD02eknYwmMFI8xP+C598Wgk2j6deZx0VpWVmpZH5snk89RmqZA8AQLQsaiU7PPzkv/YfGCAHfWmZWX21NdVw9LPP3k+Mn323XC731NZUHwsVhwgmq5OeAx9/vAlgYqNsYuZc0cb716+DG3SDbtANukE36AbdoBt0g65LJXDv22/PuF7qwMcfb0IHEVTs2NnNY7NEV3uo3eU2fZ0qV2lZWXnJkiXPo89ROfm0qeffbX5t2z5cEFRwpXeSq3PkCP3xP/zxFXSv3eU2oT7orKPHZlpqNbWv5HG4Vp7I90zt499ffvletLs3RCyWbN2ypWNq2+rVqysKb731jpmef/Szz96f6Qi7qe979NFHc6dbZ0gDAHh779uCmV4iw/FXV69enbF79+51FuOQ5FBVFftqApXh1354YYhYLInD8a1v7307kJImNzd/ZYOEprlx9kmdbkY+eVwu//HHHu0mnx+IjoY9Vnkk6uSXPxgpIPG5omLHzu7pwNpYd8ah1ekCvzqenDRnKwBcBoCOurOmk0MGwQz8+OOi5VtLy8pg396929saGoZdVosAta395botCAALioqKq06d5KMaBmpraW7yDs3w/MnnrNm0ceN9r+/aJSMDP0QslsxVJb/49t63A7JaUby8+ejxE+lTTy6hTMc4OrQIYOKYNBaDvuY/3WZ9NVpQVFSM6vgBYfdqKOiQxSt03k/m1e5wUOobGphk1M9VJb94rPJIFDqFbLq+NdadiZqblbV0qvaYzObLlo5ZrRYK2h5+NZ4QP63tbbQ4HN+Kjo7/pjRdn1vb22h/ef6vNeTrRoxGPXmhKQCAyWwGkUgku2ohqKBoUR/6Hx2FajKbYdHixRuCxWH64pWrYGo7j8v1Z6Sne1Dli8dmibZtr7imTpUsWfL8oUMHAx20OxyUyfOFMq5WREL/IyHbHQ4KKgeXlpWV1zc0MJHw0XGuAAAW45CEPEBkbQQAmLQaMHUAOVzeFYWDeGqsOxOFtNlqtVCWL1v2B1RC/qaFs6l9Bpgog5OvW716dYXTYf/KmE7t57QWoLam+ti6tb+ITbr1trCAf3U4KC3NTd51a38Ri/6m3tdxofNt1FZ2993Ca+lQnEKhamlu5todDgoCEWoLDw2970r3Vh4/tnnd2l/EVh4/thmVhsk0V5X8Ilk49U3NKxB/Z1taHykuXmErKFrUJ09JO7jl5S0/IZvPns4LUsRTfl6eC43B1XhCY5eWmdWHtPTrLEe/Flq39hexO16v2HDVOGyS/6mgmWqNvgIAFoOeXVpWVl7z7lsU8gDKExJbv23zn5eb+yB5P8CuPW/ciyZVruYG4nB8a8WOnd1zVckvokHmcbmB3TUmk5mONEQeLfebTCYtwMS6AW1398DfX3753h2vV2zY98aePVw2O4LskhBPIqEQgsVhesTT1dxAqDhEsHr16orGujNR5Hdf6Qcrvw5ZjEOSih07u0tXrniP7NZE0fLD5OucDntgUsvi9TaS3R7amDIjAExms5LqG3v1JCnYEwmF8F38cjX5bCGRUAhz0tNDJ5dwg93hoKATRaej1vY22qEP9stPVlWxEdrl0XI/WZtJ/vs8Cn4W5ucfkEfJDpL/MlJT/kx2SQHhyeWeyuPHNiOetDodZV5ObsFMGtfX17fK6bBfdjZizOz4/m9r7E5WVbFRnwOKGS33kzMZ8rEzqA1ZSLvDQfnNr3/91hUBgPwFekFy0hzfiZOnfvJdBIAUjLISvcvtHdu1b+/e7X7C/wHZDcwUfMpw/LKALiM93XNRp3topjOFyc9BfST3FRGKIQAAUExjtVrOk7VwpqCO/DwZjvsz0tM90wHyP6WpfZZHy/3HT54smY4PAICY2fH9pWVl5Sj2AQCoOnWSf0UAyHC8LSwsfEdYWPgODpe36/nNmxlf90TPa6HNr23bRzb/LAZ9zaaNG7220dFV5GwA7ZWbSidOnvpJQdGigK+tb2hgkv3+FFKi5xiGh/eEhYXvQGZ9avBE5qmx7kxUHI5vBYBARqDRaJjo2PapQWDxylUaNHbDNvsDGzc9wb3W3/S5llghLTOrjxwnaXo1FLL1ipBIksjZC+K/se5MFPk9ZNf6lSzA7R07/Z/+DElpWVn5XFXyiyaTmQ4AcPzkyZKZjjILZjDSyJ+1Oh0FSHP5CMlJSuW0P/k6Jz09tPL4sc1x0fKtre1tFJQGlpaVlSNLwuNyV9kdDorJbIaF+fkHTCbTTbt37143eeTsmunin6GhLy3CdDxpdboZM5TamupjM43dnPT00FA+z6/V6Sh2h4PS03lBWlpWVq7t7h7gM5kZQ5OpMI/L9dfWVB+baYxf+vuWuSuKlzej5wCAcvNr2/ZtvH996bN/eu7woQ/2U642pt3dPcMzWoBvQtru7gGNRsNsbW+jtba30UatVsZM16JIG5m2/Lw8F/pLTprjuxY3sG/v3u0xs+P7yXkxsgIHDh56Dm0VR/ly4cIFDevL1/kyUlMOaqcMTIREkiQQBCeQCj8+Mk9kixEeGnrf1F3AV6N9e/duRzuAUQwTyue9mpGacnBoyLCW7MrO1tfPGDNc0uvb3d6xXeQ+o/MRj1UeiSK7i5n4T1El/+s7AcC1UsWOnd1kU+v2ju3auOkJLvoTRcsPow5qejWURYsXb7hSOkg+E6C+oYE5Nytr6cWurhbD8PAeMpi0Oh0F/SFty8/Lcw3b7K8uWrx4A5knw/DwHjJP5NVCml4NBf3GwdcCwQcH7yQLgswL4idYHKa/mts4/OGHT5FTX02vhkI+S5DH5fqnjumwzf4A2QogN0ADACheuUpDqo+LYPfuq3Zmy8tbfvLk449/hj7rrKOiwx9+eG7tL9f15d2cL5qsaU972MPmvz6/8g/PPHOSVPs+PPWa4uIVNvR/U1OjIC4+kZt3c76VVGcPaFbFjp0bVSkp5Lr9rLNnzsDu3bvXlZaV1RevXLWRrCEZ6ekeXCrzkucCVq9eXYHeaXe5TTter/gKT3eX3W0l9xcAoFAQdPl3Vxi7s2fOfCSLjX3g7rK7n9f1axmoGCWPlvtVKSmOv7/88r3r1v4i4O5UKamMwltvtZLGaQOq9MlT0g7m3ZxfQOrz0ZLiFQWkeZGnLouZKisPbd2y5XnSPEJGYDLof4WQ2TabzUPXezsX2YX8EPi5Qf+j9P8B+P4bJt0V81sAAAAASUVORK5CYII=';
// Logo PT Argapura (versi tegak, sudah dipangkas, rasio 420:340) untuk kop dokumen PO; ukuran kecil seperti contoh Excel
const LOGO_PO =
  'data:image/png;base64,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';
const CO = [
  'Jl. Kedoya Agave Raya Blok A1 No.1-2,',
  'Tomang Tol Raya, Jakarta 11520',
  'P: 021-5801448 | F: 021-582-3443',
  'NPWP: 01.301.159.8-038.000',
];
const SHIP = {
  nama: 'PT ARGAPURA - FACTORY',
  alamat: [
    'Kawasan Industri Jababeka V. Jl. Science Timur I, Blok A5 No.G.',
    'Cikarang, Bekasi 17533, Indonesia, Telp 021 508 50208',
  ],
};
const FORM_DOC = { dok: 'FRM-HG-01-09', rev: '00', terbit: '02 Oktober 2019' };
const TERMS: string[] = [
  '1. Pekerjaan yang mengandung jasa akan dikenakan pajak sesuai ketentuan yang berlaku.',
  '2. Jadwal penukaran faktur (Head Office) Selasa dan Kamis, Pukul 14.00-16.00 WIB.',
  '3. Waktu pembayaran adalah 14 hari kerja, sejak invoice diterima.',
  '4. Supplier yang menggunakan prosedur uang muka, wajib melampirkan Performa Invoice.',
  '5. Supplier harap memberikan paraf pada kolom yang telah disediakan dan mengirimkan kembali Form',
];

const SATUAN = [
  '',
  'satu',
  'dua',
  'tiga',
  'empat',
  'lima',
  'enam',
  'tujuh',
  'delapan',
  'sembilan',
  'sepuluh',
  'sebelas',
];
function tb(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return tb(n - 10) + ' belas';
  if (n < 100)
    return tb(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + tb(n % 10) : '');
  if (n < 200) return 'seratus' + (n > 100 ? ' ' + tb(n - 100) : '');
  if (n < 1000)
    return (
      tb(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + tb(n % 100) : '')
    );
  if (n < 2000) return 'seribu' + (n > 1000 ? ' ' + tb(n - 1000) : '');
  if (n < 1e6)
    return (
      tb(Math.floor(n / 1e3)) + ' ribu' + (n % 1e3 ? ' ' + tb(n % 1e3) : '')
    );
  if (n < 1e9)
    return (
      tb(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + tb(n % 1e6) : '')
    );
  if (n < 1e12)
    return (
      tb(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + tb(n % 1e9) : '')
    );
  return (
    tb(Math.floor(n / 1e12)) + ' triliun' + (n % 1e12 ? ' ' + tb(n % 1e12) : '')
  );
}
const terbilang = (n: number) => {
  const w = Math.round(n) === 0 ? 'nol' : tb(Math.round(n));
  return w.charAt(0).toUpperCase() + w.slice(1) + ' rupiah';
};

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const en = (n: number, d = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: d });
const MON = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Kecilkan ukuran font bila teks tidak muat di lebar yang tersedia. */
function fitSize(txt: string, wPt: number, maxPt: number) {
  try {
    if (measureCtx === undefined)
      measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `${
        (maxPt * 96) / 72
      }px Calibri, Carlito, Arial, sans-serif`;
      const w = (measureCtx.measureText(txt).width * 72) / 96;
      if (w > wPt)
        return Math.max(5, Math.floor(((maxPt * wPt) / w) * 10) / 10);
    }
  } catch {
    /* abaikan */
  }
  return maxPt;
}
/** Perkiraan jumlah baris teks agar item yang panjang tidak keluar dari tabel. */
function lineCount(txt: string, wPt: number, sizePt: number) {
  try {
    if (measureCtx === undefined)
      measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `${
        (sizePt * 96) / 72
      }px Calibri, Carlito, Arial, sans-serif`;
      return Math.max(
        1,
        Math.ceil(
          (((measureCtx.measureText(txt).width * 72) / 96) * 1.08) / wPt
        )
      );
    }
  } catch {
    /* abaikan */
  }
  return Math.max(1, Math.ceil((txt.length * sizePt * 0.52) / wPt));
}

const DOC_CSS = `
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{position:relative;width:595.28pt;height:841pt;overflow:hidden;background:#fff;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}
.t,.r,.title{position:absolute}
.t{white-space:nowrap;font-size:8.2pt;line-height:8.2pt;overflow:hidden;text-overflow:ellipsis}
.b{font-weight:700}.i{font-style:italic}
.wrap{white-space:pre-line;line-height:10.44pt;overflow:hidden;text-overflow:clip}
.title{left:204pt;width:200.9pt;top:31pt;text-align:center;white-space:nowrap;font:900 16.3pt/16.3pt "Arial Black","Arial Bold",Arial,sans-serif;text-shadow:.7pt .7pt .9pt rgba(0,0,0,.45)}
.ul{box-shadow:.7pt .7pt .9pt rgba(0,0,0,.45)}
@media screen{body{background:#cfd6e0;padding:0 0 1px}.sheet{margin:0 auto 12px}}
`;

type O = { b?: boolean; i?: boolean; s?: number; c?: string; w?: number };
const sty = (o: O, base: string[]) => {
  if (o.s) base.push(`font-size:${o.s}pt`, `line-height:${o.s}pt`);
  if (o.c) base.push(`color:${o.c}`);
  return `${o.b ? ' b' : ''}${o.i ? ' i' : ''}" style="${base.join(';')}`;
};
/** teks rata kiri di koordinat (x,y) dalam pt, sama dengan PDF contoh */
const TL = (x: number, y: number, s: string, o: O = {}) =>
  `<div class="t${sty(o, [
    `left:${x}pt`,
    `top:${y}pt`,
    ...(o.w ? [`width:${o.w}pt`] : []),
  ])}">${s}</div>`;
const TR = (x1: number, y: number, s: string, o: O = {}) => {
  const w = o.w ?? 100;
  return `<div class="t${sty(o, [
    `left:${x1 - w}pt`,
    `top:${y}pt`,
    `width:${w}pt`,
    'text-align:right',
  ])}">${s}</div>`;
};
const TC = (cx: number, y: number, s: string, o: O = {}) => {
  const w = o.w ?? 80;
  return `<div class="t${sty(o, [
    `left:${cx - w / 2}pt`,
    `top:${y}pt`,
    `width:${w}pt`,
    'text-align:center',
  ])}">${s}</div>`;
};
const BX = (
  x: number,
  y: number,
  w: number,
  h: number,
  bg = '#000',
  cls = ''
) =>
  `<div class="r ${cls}" style="left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt;background:${bg}"></div>`;

const BODY_H = 221.78,
  ROW_H = 15.36,
  LINE_H = 10.44;
const COLS = [29.4, 354.91, 398.59, 443.26, 510.46];

// Unduh/cetak PO langsung dari tabel (tanpa membuka viewer): dialog cetak muncul, pilih "Simpan sebagai PDF" untuk mengunduh
function downloadPoPdf(po: PO) {
  const ifr = document.createElement('iframe');
  ifr.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  ifr.srcdoc = poHtml(po);
  ifr.onload = () => {
    const w = ifr.contentWindow;
    if (!w) return;
    const t = document.title;
    document.title = 'PO ' + po.no.split('/').join('-');
    w.focus();
    w.print();
    window.setTimeout(() => {
      document.title = t;
      ifr.remove();
    }, 2000);
  };
  document.body.appendChild(ifr);
}

function poHtml(po: PO): string {
  const v = po.v,
    pay = po.pay ?? EMPTY_PAY,
    ong = po.ong ?? 0;
  const sub = po.items.reduce((a, l) => a + l.q * l.p, 0);
  const c = calc(sub, po.rate, po.disc, ong);
  const d = new Date(po.iso);
  const tgl = `${String(d.getDate()).padStart(2, '0')}-${
    MON[d.getMonth()]
  }-${d.getFullYear()}`;

  // bagi item ke halaman (14 baris per halaman; item panjang memakai lebih dari satu baris)
  type Row = { l: Line; n: number; h: number };
  const big = po.items.length > 14; // lebih dari 14 item: tabel dua kolom (30 baris x 2) seperti PO contoh
  const BIG_CAP = 60;
  const pages: Row[][] = [[]];
  let used = 0;
  po.items.forEach((l, n) => {
    if (big) {
      if (pages[pages.length - 1].length >= BIG_CAP) pages.push([]);
      pages[pages.length - 1].push({ l, n, h: 0 });
      return;
    }
    const h = ROW_H + (lineCount(l.d, 318, 8.2) - 1) * LINE_H;
    if (used + h > BODY_H && pages[pages.length - 1].length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push({ l, n, h });
    used += h;
  });
  const total = pages.length;

  const sheet = (rows: Row[], pi: number) => {
    const last = pi === total - 1;
    const dy = big ? 46.7 : 0; // semua bagian di bawah tabel turun mengikuti tabel dua kolom
    const sy = big ? 11.4 : 0; // blok NPWP/rekening turun karena alamat supplier
    const o: string[] = [];
    // kop
    o.push(
      `<img class="r" alt="" src="${LOGO_PO}" style="left:18.4pt;top:17pt;width:56pt;height:45.3pt;object-fit:contain">`
    );
    o.push(
      `<svg class="r" style="left:219.6pt;top:20pt;width:172pt;height:34pt" viewBox="0 0 172 34"><g font-family="'Arial Black','Arial Bold',Arial,sans-serif" font-weight="900" font-size="16.35"><text x=".7" y="26.7" textLength="169.67" lengthAdjust="spacingAndGlyphs" fill="rgba(0,0,0,.45)">PURCHASE ORDER</text><text x="0" y="26" textLength="169.67" lengthAdjust="spacingAndGlyphs" fill="#000">PURCHASE ORDER</text></g></svg>`,
      BX(219.6, 48, 169.6, 1, '#000', 'ul')
    );
    CO.forEach((s, k) =>
      o.push(
        TL(18.4, [79.8, 90.1, 100.5, 110.8][k], s, { b: true, c: '#595959' })
      )
    );
    o.push(
      TL(445.1, 70.7, 'No', { b: true }),
      TL(465.7, 70.7, esc(po.no), { b: true }),
      TL(445.1, 79.9, 'Date', { b: true }),
      TL(465.7, 79.5, tgl, { b: true })
    );
    // supplier
    o.push(
      TL(18.4, 150.1, 'SUPPLIER', { b: true, c: '#808080' }),
      TL(18.4, 161.2, esc(v.nama), { b: true, w: 330 })
    );
    o.push(
      `<div class="t wrap" style="left:18.4pt;top:171pt;width:330pt;height:41.4pt">${esc(
        v.alamat
      )}</div>`
    );
    o.push(
      TL(18.4, 215.9 + sy, 'NPWP', { b: true }),
      TL(57.6, 215.9 + sy, esc(v.npwp), { w: 132 })
    );
    o.push(
      TL(18.4, 226.2 + sy, 'Phone', { b: true }),
      TL(57.6, 226.2 + sy, esc(v.telp + (v.fax ? ' / Fax ' + v.fax : '')), {
        w: 132,
      })
    );
    o.push(
      TL(18.4, 236.5 + sy, 'PIC Name', { b: true }),
      TL(57.6, 236.5 + sy, esc(v.pic), { w: 132 })
    );
    o.push(
      TL(18.4, 248.4 + sy, 'Email', { b: true }),
      TL(57.6, 247.5 + sy, esc(v.email), { w: 132 })
    );
    o.push(
      TL(192.3, 215.9 + sy, 'No Rek', { b: true }),
      TL(225.2, 215.9 + sy, esc(pay.rek), { w: 126 })
    );
    o.push(
      TL(192.3, 226.2 + sy, 'Bank', { b: true }),
      TL(225.2, 226.2 + sy, esc(pay.bank), { w: 126 })
    );
    o.push(
      TL(192.3, 236.5 + sy, 'Cabang', { b: true }),
      TL(225.2, 236.5 + sy, esc(pay.cabang), { w: 126 })
    );
    o.push(
      TL(192.3, 248.4 + sy, 'A/N', { b: true }),
      TL(225.2, 247.5 + sy, esc(pay.an), { w: 126 })
    );
    // alamat pengiriman
    o.push(BX(354.91, 148.59, 0.48, 108.74 + sy));
    o.push(
      TL(356.7, 150.6, 'Alamat Pengiriman', { b: true, c: '#808080' }),
      TL(356.7, 161.2, SHIP.nama, { b: true })
    );
    o.push(
      `<div class="t" style="left:356.7pt;top:171pt;line-height:10.44pt;overflow:visible">${SHIP.alamat.join(
        '<br>'
      )}</div>`
    );
    o.push(
      TL(356.7, 193.6 + sy + 0.6, 'PIC Name', { b: true }),
      TL(400.4, 193.6 + sy + 0.6, esc(po.by), { w: 160 })
    );

    // tabel item
    if (big) {
      // Model dua kolom: kiri baris 1-30, kanan baris 31-60 (otomatis, ukuran sama dengan PO contoh)
      const T0 = 286.9,
        HH = 8.3,
        RH = 8.53,
        BT = 551.2,
        FS = 6.7;
      const XS = [
        [17.3, 34.2, 143.6, 172.8, 202.0, 248.0, 289.6],
        [294.8, 312.1, 423.4, 452.5, 481.7, 527.8, 571.3],
      ];
      const HEAD = [
        'No',
        'Deskripsi',
        'Jumlah',
        'Satuan',
        'Harga satuan',
        'Total',
      ];
      XS.forEach((X) => {
        o.push(BX(X[0], T0, X[6] - X[0], HH));
        HEAD.forEach((h, k) =>
          o.push(
            TC((X[k] + X[k + 1]) / 2, T0 + 0.9, h, {
              c: '#fff',
              s: FS + 0.2,
              w: X[k + 1] - X[k],
            })
          )
        );
        X.forEach((x, k) => {
          if (k > 0 && k < 6) o.push(BX(x - 0.24, T0, 0.48, HH, '#fff'));
          o.push(BX(x - 0.24, T0 + HH, 0.48, BT - T0 - HH));
        });
        o.push(BX(X[0], BT - 0.48, X[6] - X[0], 0.48));
      });
      rows.forEach((r, i) => {
        const X = XS[i < 30 ? 0 : 1],
          y = T0 + HH + (i % 30) * RH + (RH - FS) / 2 - 0.2;
        const dsc = esc(r.l.d),
          w = X[2] - X[1] - 3,
          fs = fitSize(r.l.d, w, FS);
        o.push(
          TC((X[0] + X[1]) / 2, y, String(r.n + 1), { s: FS, w: X[1] - X[0] })
        );
        o.push(TL(X[1] + 1.6, y, dsc, { s: fs, w }));
        o.push(
          TC((X[2] + X[3]) / 2, y, en(r.l.q, 2), { s: FS, w: X[3] - X[2] }),
          TC((X[3] + X[4]) / 2, y, esc(r.l.s), { s: FS, w: X[4] - X[3] })
        );
        o.push(
          TR(X[5] - 2, y, en(r.l.p, 2), { s: FS, w: X[5] - X[4] - 2 }),
          TR(X[6] - 2, y, en(r.l.q * r.l.p), { s: FS, w: X[6] - X[5] - 2 })
        );
      });
    } else {
      o.push(BX(16.8, 274.01, 555, 15.48));
      COLS.forEach((x) => o.push(BX(x, 274.25, 0.48, 14.88, '#fff')));
      o.push(TC(23.5, 278.1, 'No', { b: true, c: '#fff', w: 12.8 }));
      (
        [
          [192.4, 'Diskripsi'],
          [377, 'Jumlah'],
          [421.2, 'Satuan'],
          [477.1, 'Harga Satuan'],
          [541.2, 'Total Biaya'],
        ] as [number, string][]
      ).forEach(([x, s]) =>
        o.push(TC(x, 278.4, s, { b: true, c: '#fff', s: 7.2 }))
      );
      o.push(
        BX(17.04, 273.77, 554.88, 0.48),
        BX(16.56, 273.77, 0.48, 237.62),
        BX(17.04, 510.91, 554.88, 0.48)
      );
      o.push(BX(571.44, 274.25, 0.48, last ? 301.34 : 237.14));
      COLS.forEach((x) => o.push(BX(x, 289.61, 0.48, 221.78)));
      let y = 0;
      const cells: string[] = [];
      rows.forEach((r) => {
        cells.push(TC(23.5, y + 4.1, String(r.n + 1), { w: 12.8 }));
        cells.push(
          `<div class="t wrap" style="left:31.2pt;top:${
            y + 2.5
          }pt;width:322pt;height:${r.h - 3}pt">${esc(r.l.d)}</div>`
        );
        cells.push(
          TC(377, y + 4.1, en(r.l.q, 2)),
          TC(421.2, y + 4.1, esc(r.l.s)),
          TC(477.1, y + 4.1, en(r.l.p, 2)),
          TR(570.2, y + 4.1, en(r.l.q * r.l.p))
        );
        y += r.h;
      });
      o.push(
        `<div class="r" style="left:0;top:289.61pt;width:595pt;height:${BODY_H}pt;overflow:hidden">${cells.join(
          ''
        )}</div>`
      );
    }

    // syarat & ketentuan
    if (big) {
      o.push(
        TL(19.8, 564.4, 'Syarat dan Ketentuan:', { b: true, s: 7.2 }),
        BX(19.83, 570.5, 66.5, 0.49)
      );
      TERMS.forEach((t, k) =>
        o.push(
          TL(19.8, [573.0, 580.5, 587.9, 595.4, 602.8][k], t, {
            b: true,
            s: 6.1,
          })
        )
      );
      o.push(
        TL(
          25.3,
          610.3,
          'Purchase Order (PO) ini sebagai bukti pesanan telah diterima.',
          { b: true, s: 6.1 }
        )
      );
    } else {
      o.push(
        TL(19.8, 518, 'Syarat dan Ketentuan:', { b: true }),
        BX(19.83, 526.2, 75.7, 0.49)
      );
      TERMS.forEach((t, k) =>
        o.push(
          TL(19.8, [527.7, 536.4, 545.2, 553.9, 562.6][k], t, {
            b: true,
            s: 7.2,
          })
        )
      );
    }

    if (last) {
      // ringkasan nominal
      const lab = [
        'Sub Total 1',
        'Diskon',
        'Sub Total 2',
        taxName(po.rate),
        'Ongkir',
        'TOTAL',
      ];
      const val = [sub, po.disc, c.s2, c.ppn, ong, c.total];
      for (let k = 0; k <= 6; k++)
        o.push(BX(443.74, 513.19 + dy + 10.32 * k, 128.18, 0.48));
      o.push(
        BX(443.26, 513.19 + dy, 0.48, 62.4),
        BX(510.46, 513.19 + dy, 0.48, 62.4)
      );
      if (big) o.push(BX(571.44, 559.87, 0.48, 62.45)); // garis kanan kotak ringkasan (mode dua kolom tidak punya garis tepi tabel yang memanjang ke bawah)
      lab.forEach((s, k) => {
        o.push(
          TL(445.1, 514.8 + dy + 10.3 * k, s, { b: true }),
          TL(515.4, 515.2 + dy + 10.32 * k, 'Rp', { b: true })
        );
        o.push(
          TR(567.6, 515.2 + dy + 10.32 * k, val[k] ? en(val[k]) : '-', {
            b: true,
          })
        );
      });
      // terbilang
      o.push(
        TL(18.4, 578.9 + dy, 'Terbilang', { b: true }),
        BX(72.5, 577.63 + dy, 499.3, 10.44, '#d9d9d9')
      );
      o.push(
        TL(74.1, 579.4 + dy, esc(terbilang(c.total)), {
          b: true,
          i: true,
          w: 495,
        })
      );
      // catatan
      o.push(
        `<svg class="r" style="left:16.5pt;top:${
          601.3 + dy
        }pt;width:214.7pt;height:82.5pt" viewBox="0 0 214.7 82.5"><rect x=".26" y=".26" width="214.18" height="81.98" rx="13.7" ry="13.7" fill="none" stroke="#000" stroke-width=".51"/></svg>`
      );
      o.push(TL(27.5, 604.5 + dy, 'Catatan:', { b: true, s: 8.1 }));
      if (po.note)
        o.push(
          `<div class="t wrap" style="left:27.5pt;top:${
            616 + dy
          }pt;width:196pt;height:62pt">${esc(po.note)}</div>`
        );
      // tanda tangan
      const sx = [309.67, 370.56, 432.92, 494.24, 556.45];
      [603.21, 611.8, 664.9, 673.69].forEach((yy) =>
        o.push(BX(309.67, yy + dy, 246.78, 0.3))
      );
      sx.forEach((x) => o.push(BX(x, 603.21 + dy, 0.3, 70.78)));
      [
        'Diajukan oleh',
        'Diketahui oleh',
        'Disetujui oleh',
        'Diterima Supplier',
      ].forEach((s, k) =>
        o.push(
          TC((sx[k] + sx[k + 1]) / 2, 604.8 + dy, s, { b: true, s: 7.2, w: 60 })
        )
      );
      {
        const fs = fitSize(po.by, 56, 8.2);
        o.push(
          `<div class="t" style="left:309.67pt;top:${
            664.9 + dy
          }pt;width:60.89pt;height:8.79pt;padding:0 1.5pt 1.6pt;display:flex;align-items:center;justify-content:center;overflow:visible;font-size:${fs}pt;line-height:${fs}pt">${esc(
            po.by
          )}</div>`
        );
      }
    } else {
      o.push(
        TR(570, big ? 553 : 516, 'Bersambung ke halaman berikutnya…', {
          i: true,
          s: 7.2,
          w: 200,
        })
      );
    }

    // footer
    o.push(
      BX(17.04, 695.14 + dy, 554.88, 0.48),
      BX(17.04, 705.46 + dy, 554.88, 0.48)
    );
    [16.56, 190.49, 354.91, 510.46, 571.44].forEach((x) =>
      o.push(BX(x, 695.62 + dy, 0.48, 10.32))
    );
    o.push(
      TL(18.4, 696.9 + dy, `No. Dokumen : ${FORM_DOC.dok}`),
      TL(192.3, 696.9 + dy, `Revisi : ${FORM_DOC.rev}`),
      TL(356.7, 696.9 + dy, `Tanggal terbit : ${FORM_DOC.terbit}`),
      TL(512.3, 696.9 + dy, `Halaman : ${pi + 1}/${total}`)
    );
    return `<div class="sheet">${o.join('')}</div>`;
  };

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>PO ${esc(
    po.no
  )}</title><style>${DOC_CSS}</style></head><body>${pages
    .map((r, i) => sheet(r, i))
    .join('')}</body></html>`;
}

/* Tampilan dokumen PO + tombol cetak/download. Dipakai admin (halaman Dokumen PO) dan user (popup). */
/** teks tooltip tombol cetak yang belum bisa dipakai user */
const waitTip = (p: PO) =>
  p.rej ? 'Pengajuan ditolak admin' : 'Menunggu approve admin';
function PoViewer({
  po,
  list,
  onPick,
  onClose,
  onBack,
  backLabel,
  canPrint = true,
  admin = false,
  onPrinted,
}: {
  po: PO;
  list?: PO[];
  onPick?: (no: string) => void;
  onClose?: () => void;
  onBack?: () => void;
  backLabel?: string;
  canPrint?: boolean;
  admin?: boolean;
  onPrinted?: (no: string) => void;
}) {
  const html = useMemo(() => poHtml(po), [po]);
  const pn = po.printN ?? 0;
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(1140);
  const [sc, setSc] = useState(1);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () =>
      setSc(Math.min(1, Math.max(0.3, (el.clientWidth - 24) / 794)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loaded = () => {
    const d = frame.current?.contentDocument;
    if (d) setH(d.documentElement.scrollHeight);
  };
  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const t = document.title;
    document.title = 'PO ' + po.no.split('/').join('-'); // nama file default saat Simpan sebagai PDF
    w.focus();
    w.print();
    window.setTimeout(() => {
      document.title = t;
    }, 1500);
    onPrinted?.(po.no);
  };
  // membuka tab baru = bisa dicetak dari sana, jadi dihitung sebagai cetak juga
  const newTab = () => {
    window.open(
      URL.createObjectURL(new Blob([html], { type: 'text/html' })),
      '_blank'
    );
    onPrinted?.(po.no);
  };

  return (
    <div className="viewer">
      <div className="vbar">
        {list && (
          <div className="vsel">
            <label>Pilih Nomor PO</label>
            <select value={po.no} onChange={(e) => onPick?.(e.target.value)}>
              {list.map((p) => (
                <option key={p.no} value={p.no}>
                  {p.no} — {p.v.nama} ({p.dept})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="vinfo">
          <b>{po.no}</b>
          <small>
            {po.v.nama} · {fmt(po.iso)} · {rp(po.total)}
          </small>
        </div>
        <div className="vact">
          {onBack && (
            <button onClick={onBack}>
              <Ic n="left" s={14} /> {backLabel ?? 'Kembali'}
            </button>
          )}
          {canPrint ? (
            <button className="pri prgreen" onClick={print}>
              🖨 Cetak / Download PDF
            </button>
          ) : (
            <span className="tipw" data-tip={waitTip(po)}>
              <button type="button" className="off" aria-disabled="true">
                🖨 Cetak / Download PDF
              </button>
            </span>
          )}
          {canPrint ? (
            <button onClick={newTab}>Buka di tab baru</button>
          ) : (
            <span className="tipw" data-tip={waitTip(po)}>
              <button type="button" className="off" aria-disabled="true">
                Buka di tab baru
              </button>
            </span>
          )}
          {onClose && <button onClick={onClose}>Tutup</button>}
        </div>
      </div>
      <p className="mute small">
        Ukuran A4 portrait. Pada dialog cetak pilih printer, atau pilih “Simpan
        sebagai PDF” untuk mengunduh. Atur Margin = None/Tidak ada dan Skala =
        100%.
      </p>
      <div className="vpaper" ref={box}>
        <div style={{ width: 794 * sc, height: h * sc }}>
          <iframe
            ref={frame}
            title={'PO ' + po.no}
            srcDoc={html}
            onLoad={loaded}
            style={{
              width: 794,
              height: h,
              transform: `scale(${sc})`,
              transformOrigin: '0 0',
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* Cari riwayat PO berdasarkan supplier, lalu salin ke form */
function History({
  list,
  onApply,
}: {
  list: PO[];
  onApply: (p: PO, picked: number[] | null) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [drop, setDrop] = useState(true);
  const key = q.trim().toLowerCase();
  const rows = [...list]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .filter((p) => !key || p.v.nama.toLowerCase().includes(key));
  const shown = rows.slice(0, 6);
  const toggle = (p: PO) => {
    if (open === p.no) return setOpen('');
    setOpen(p.no);
    setSel(p.items.map((_, n) => n));
  };
  return (
    <Card ic="search" title="Cari Riwayat PO (berdasarkan Supplier)">
      <div className="body">
        <p className="mute small">
          Ketik nama supplier untuk menyalin data supplier dan item, lalu
          sesuaikan pembeliannya. Nomor PO baru dibuat otomatis saat request
          dikirim.
        </p>
        <div className="ifld cmb">
          <span className="ico">
            <Ic n="search" s={18} />
          </span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setDrop(true);
            }}
            placeholder="Ketik nama supplier..."
          />
          <button
            type="button"
            className="arr"
            aria-label={drop ? 'Sembunyikan riwayat' : 'Tampilkan riwayat'}
            onClick={() => setDrop((d) => !d)}
          >
            <Ic n={drop ? 'down' : 'up'} s={18} />
          </button>
        </div>
        {drop && list.length === 0 && (
          <div className="mute">Belum ada riwayat PO di departemen Anda.</div>
        )}
        {drop && list.length > 0 && shown.length === 0 && (
          <div className="mute">Tidak ada supplier yang cocok.</div>
        )}
        {drop &&
          shown.map((p) => (
            <div className="hist" key={p.no}>
              <button type="button" className="hhead" onClick={() => toggle(p)}>
                <span className="hi">
                  <Ic n="building" s={22} />
                </span>
                <span className="ht">
                  <b>{p.v.nama}</b>
                  <small>
                    {p.no} · {fmt(p.iso)} · {p.items.length} item ·{' '}
                    {rp(p.total)}
                  </small>
                </span>
                <Ic n={open === p.no ? 'up' : 'down'} s={18} />
              </button>
              {open === p.no && (
                <div className="hbody">
                  {p.items.map((l, n) => (
                    <label key={n} className="chk">
                      <input
                        type="checkbox"
                        checked={sel.includes(n)}
                        onChange={() =>
                          setSel((x) =>
                            x.includes(n) ? x.filter((i) => i !== n) : [...x, n]
                          )
                        }
                      />
                      <span>
                        {l.d} — {l.q} {l.s} × {rp(l.p)}
                      </span>
                    </label>
                  ))}
                  <div className="acts">
                    <button className="ghost" onClick={() => onApply(p, null)}>
                      Salin supplier saja
                    </button>
                    <button
                      className="pri"
                      disabled={!sel.length}
                      onClick={() =>
                        onApply(
                          p,
                          [...sel].sort((a, b) => a - b)
                        )
                      }
                    >
                      Salin supplier + item terpilih
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        {drop && rows.length > shown.length && (
          <div className="mute small" style={{ marginTop: 8 }}>
            Menampilkan {shown.length} dari {rows.length} riwayat. Persempit
            pencarian.
          </div>
        )}
      </div>
    </Card>
  );
}

/* Cari supplier di Master Supplier (diunggah admin) lalu salin data umum + pembayaran ke form */
function MasterPick({
  list,
  onApply,
}: {
  list: MSup[];
  onApply: (m: MSup) => void;
}) {
  const [q, setQ] = useState('');
  const key = q.trim().toLowerCase();
  const sorted = useMemo(
    () => [...list].sort((a, b) => a.nama.localeCompare(b.nama)),
    [list]
  );
  const rows = sorted
    .filter(
      (m) =>
        !key ||
        (m.nama + ' ' + m.npwp + ' ' + m.pic).toLowerCase().includes(key)
    )
    .slice(0, 6);
  return (
    <Card ic="users" title="Cari Master Supplier">
      <div className="body">
        <p className="mute small">
          Pilih supplier dari Master Supplier (dikelola admin) untuk mengisi
          General Information dan Informasi Pembayaran otomatis, tanpa ketik
          ulang.
        </p>
        <div className="ifld cmb">
          <span className="ico">
            <Ic n="search" s={18} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ketik nama supplier, NPWP, atau PIC..."
          />
        </div>
        {!list.length && (
          <div className="mute">
            Master Supplier belum diisi admin. Gunakan pencarian riwayat PO
            atau isi manual.
          </div>
        )}
        {list.length > 0 && key && !rows.length && (
          <div className="mute">Tidak ada supplier yang cocok.</div>
        )}
        {rows.map((m) => {
          const miss = msMissing(m);
          return (
            <div className="hist" key={m.id}>
              <button
                type="button"
                className="hhead"
                onClick={() => onApply(m)}
              >
                <span className="hi">
                  <Ic n="building" s={22} />
                </span>
                <span className="ht">
                  <b>{m.nama}</b>
                  <small>
                    {[m.pic, m.telp, m.bank && `${m.bank} ${m.rek}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                  {miss.length > 0 && (
                    <small className="msmiss">
                      Data belum lengkap: perlu dilengkapi manual
                    </small>
                  )}
                </span>
                <span className="pri msuse">Gunakan</span>
              </button>
            </div>
          );
        })}
        {list.length > 0 && !key && (
          <div className="mute small" style={{ marginTop: 8 }}>
            {list.length} supplier tersedia. Ketik untuk mencari.
          </div>
        )}
      </div>
    </Card>
  );
}

/* ================= PANDUAN KATEGORI (popup untuk user saat mengisi Form PO) ================= */
function CatGuide({
  cats,
  current,
  onPick,
  onClose,
}: {
  cats: Cat[];
  current: string;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [t, setT] = useState<'all' | CatType>('all');
  const rows = cats.filter(
    (c) => !c.off && (t === 'all' || c.type === t) && catMatch(c, q)
  );
  return (
    <div
      className="modal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="viewer">
        <div className="vbar">
          <div className="vinfo">
            <b>Panduan Kategori Barang/Jasa</b>
            <small>
              Cari barang/jasa yang akan dibeli, lalu klik Pilih pada kategori
              yang sesuai.
            </small>
          </div>
          <div className="vact">
            <button onClick={onClose}>Tutup</button>
          </div>
        </div>
        <div className="bar">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari, mis. helm, laptop, servis AC, ekspedisi..."
            aria-label="Cari kategori"
          />
          <div className="cseg">
            {(['all', 'Barang', 'Jasa'] as const).map((x) => (
              <button
                key={x}
                className={t === x ? 'on' : ''}
                onClick={() => setT(x)}
              >
                {x === 'all' ? 'Semua' : x}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Nama Kategori</th>
                <th>Tipe</th>
                <th>Deskripsi</th>
                <th>Contoh Pengajuan PO</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.name}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>
                    <span
                      className={'tag ' + (c.type === 'Jasa' ? 's-Done' : '')}
                    >
                      {c.type}
                    </span>
                  </td>
                  <td>{c.desc ?? '-'}</td>
                  <td>{c.ex ?? '-'}</td>
                  <td>
                    <div className="acts sm">
                      <button className="pri" onClick={() => onPick(c.name)}>
                        {c.name === current ? 'Dipilih' : 'Pilih'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    Tidak ada kategori yang cocok dengan “{q}”. Coba kata lain,
                    atau hubungi admin untuk menambah kategori.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ================= FORM PO ================= */
function Form({
  me,
  pos,
  draft,
  cats,
  bps,
  msup,
  cfg,
  taxes,
  onSubmit,
  notify,
  fixedNo,
  readOnly,
  onBack,
}: {
  taxes: Tax[];
  me: User;
  pos: PO[];
  draft: Draft | null;
  cats: Cat[];
  bps: BP[];
  msup: MSup[];
  cfg: NumCfg;
  onSubmit: (p: PO) => void;
  notify: (m: string) => void;
  fixedNo?: string | null; // nomor PO yang sedang diperbaiki/dilihat (null = pengajuan baru)
  readOnly?: boolean; // mode lihat saja (admin): semua isian terkunci
  onBack?: () => void; // tombol Batal (edit) / Kembali (lihat)
}) {
  const [v, setV] = useState<Vendor>(draft?.v ?? EMPTY);
  const [pay, setPay] = useState<Pay>(draft?.pay ?? EMPTY_PAY);
  const [items, setItems] = useState<Item[]>(draft?.items ?? [newItem()]);
  const [cat, setCat] = useState<string>(
    draft?.items.find((x) => x.k)?.k ?? ''
  ); // satu kategori untuk seluruh item dalam PO
  const [guide, setGuide] = useState(false); // popup panduan kategori
  const [tax, setTax] = useState(draft?.rate ?? '');
  const [disc, setDisc] = useState(draft?.disc ?? '');
  const [ong, setOng] = useState(draft?.ong ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [infoOpen, setInfoOpen] = useState(true);

  const sub = useMemo(
    () =>
      items.reduce((a, i) => a + (Number(i.q) || 0) * (Number(i.p) || 0), 0),
    [items]
  );
  const rate = Number(tax) || 0;
  const dv = Number(disc) || 0;
  const ov = Number(ong) || 0;
  const { ppn, total: grand } = calc(sub, rate, dv, ov);
  const sv = (k: keyof Vendor, val: string) =>
    setV((x) => ({ ...x, [k]: val }));
  const sp = (k: keyof Pay, val: string) => setPay((x) => ({ ...x, [k]: val }));
  const si = (id: number, k: keyof Item, val: string) =>
    setItems((l) => l.map((i) => (i.id === id ? { ...i, [k]: val } : i)));
  const history = pos.filter((p) => sameDept(p.dept, me.dept));
  const bp = v.nama.trim()
    ? bps.find((b) => supKey(b.nama) === supKey(v.nama))
    : undefined;
  const bi = bp ? bpInfo(bp.exp) : null;
  const bpWarn =
    bp && bi && (bi.expired || bi.soon) ? (
      <div className={'bpw' + (bi.expired ? ' bad' : '')}>
        {bi.expired
          ? `⚠ Supplier BP ${bp.kode} sudah Expired sejak ${fmtD(bp.exp)}.`
          : `⚠ Supplier BP ${bp.kode} akan Expired ${fmtD(bp.exp)} (${
              bi.days
            } hari lagi).`}
      </div>
    ) : null;

  // Salin dari riwayat: supplier + pembayaran selalu diganti; item terpilih ditambahkan ke daftar item
  const apply = (p: PO, picked: number[] | null) => {
    setV({ ...p.v });
    setPay({ ...(p.pay ?? EMPTY_PAY) });
    if (picked) {
      const k0 = p.items[picked[0]]?.k;
      if (!cat && k0) setCat(k0);
      setItems((l) => [
        ...l.filter((i) => i.d.trim() || i.q || i.s || i.p),
        ...picked.map((n) =>
          newItem({
            d: p.items[n].d,
            q: String(p.items[n].q),
            s: p.items[n].s,
            p: String(p.items[n].p),
            k: p.items[n].k ?? '',
          })
        ),
      ]);
    }
    notify(
      picked
        ? 'Supplier & item disalin. Sesuaikan qty/harga. Nomor PO baru dibuat otomatis.'
        : 'Data supplier & pembayaran disalin. Lengkapi item barang.'
    );
  };

  // Salin dari Master Supplier: General Information + Informasi Pembayaran. soft = hanya bila isian masih kosong (pengisian otomatis saat mengetik nama)
  const applyMaster = (m: MSup, soft: boolean) => {
    const payEmpty = Object.values(pay).every((x) => !x.trim());
    setV(msToVendor(m));
    if (!soft || payEmpty) setPay(msToPay(m));
    notify(
      msMissing(m).length
        ? `Data ${m.nama} terisi dari Master Supplier. Lengkapi isian yang masih kosong.`
        : `Data ${m.nama} terisi otomatis dari Master Supplier.`
    );
  };

  const activeCats = cats.filter((c) => !c.off);
  // pilih kategori sekali untuk seluruh PO; untuk tipe Jasa satuan item yang kosong otomatis "Jasa"
  const pickCat = (name: string) => {
    setCat(name);
    if (cats.find((c) => c.name === name)?.type === 'Jasa')
      setItems((l) => l.map((i) => (i.s ? i : { ...i, s: 'Jasa' })));
  };
  const catObj = cats.find((c) => c.name === cat);
  const send = () => {
    const yr = new Date().getFullYear();
    if (lockedYear(cfg, yr))
      return notify(
        `Periode ${yr} terkunci oleh admin. PO baru belum bisa dibuat.`
      );
    const { fax, ...must } = v;
    void fax;
    if (
      Object.values(must).some((x) => !x.trim()) ||
      Object.values(pay).some((x) => !x.trim()) ||
      !tax
    )
      return notify('Lengkapi semua isian bertanda *');
    if (
      items.some(
        (i) => !i.d.trim() || !(Number(i.q) > 0) || !i.s || !(Number(i.p) > 0)
      )
    )
      return notify('Lengkapi detail setiap item');
    if (!activeCats.some((c) => c.name === cat))
      return notify(
        cat
          ? `Kategori "${cat}" sudah nonaktif. Pilih kategori lain.`
          : 'Pilih kategori barang/jasa terlebih dahulu'
      );
    onSubmit({
      no: fixedNo ?? nextNo(pos, cfg),
      iso: new Date().toISOString(),
      dept: me.dept,
      uid: me.id,
      by: me.nama,
      v,
      pay,
      items: items.map((i) => ({
        d: i.d,
        q: Number(i.q),
        s: i.s,
        p: Number(i.p),
        k: cat,
      })),
      sub,
      rate,
      disc: dv,
      ong: ov,
      note: note.trim(),
      total: grand,
      status: 'Open',
      ...(!fixedNo && draft?.prev ? { prevNo: draft.prev } : {}),
    });
  };

  return (
    <div className="two">
      {guide && (
        <CatGuide
          cats={cats}
          current={cat}
          onClose={() => setGuide(false)}
          onPick={(n) => {
            pickCat(n);
            setGuide(false);
          }}
        />
      )}
      <div className="cl">
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          <MasterPick list={msup} onApply={(m) => applyMaster(m, false)} />
          <History list={history} onApply={apply} />
        </fieldset>
      </div>
      <div className="cr">
        {readOnly && (
          <div className="info">
            <span>
              Mode lihat saja — isian pengajuan ini tidak dapat diubah.
            </span>{' '}
            <button type="button" className="ghost" onClick={onBack}>
              Kembali
            </button>
          </div>
        )}
        <Card ic="file" title="Data PO">
          <div className="body">
            <div className="info">
              <Ic n="gear" s={20} />
              <span>
                {readOnly
                  ? 'Menampilkan isian pengajuan (mode lihat saja).'
                  : fixedNo
                  ? 'Perbaikan pengajuan ditolak — nomor pengajuan tetap sama.'
                  : 'Nomor pengajuan dibuat otomatis saat request dikirim.'}
              </span>
            </div>
            <div className="kvi">
              <div>
                <span>
                  <Ic n="file" s={18} />
                  No. Pengajuan
                </span>
                <b>
                  {fixedNo ?? nextNo(pos, cfg)}{' '}
                  <em className="tag">
                    {fixedNo ? (readOnly ? 'Lihat' : 'Perbaikan') : 'Auto'}
                  </em>
                </b>
              </div>
              <div>
                <span>
                  <Ic n="calendar" s={18} />
                  Tanggal
                </span>
                <b>{fmt(draft?.iso ?? new Date().toISOString())}</b>
              </div>
              <div>
                <span>
                  <Ic n="building" s={18} />
                  Departemen
                </span>
                <b>{me.dept}</b>
              </div>
              <div>
                <span>
                  <Ic n="user" s={18} />
                  Pemohon
                </span>
                <b>{me.nama}</b>
              </div>
            </div>
            <div className="sum">
              <div>
                <span>
                  <Ic n="receipt" s={18} />
                  Subtotal
                </span>
                <span>{rp(sub)}</span>
              </div>
              <div>
                <span>
                  <Ic n="receipt" s={18} />
                  Discount
                </span>
                <span>{rp(dv)}</span>
              </div>
              <div>
                <span>
                  <Ic n="receipt" s={18} />
                  Pajak{rate ? ` (${taxName(rate, taxes)})` : ''}
                </span>
                <span>{rp(ppn)}</span>
              </div>
              <div>
                <span>
                  <Ic n="truck" s={18} />
                  Ongkir
                </span>
                <span>{rp(ov)}</span>
              </div>
              <div className="gt">
                <span>
                  <Ic n="coins" s={22} />
                  Grand Total
                </span>
                <span>{rp(grand)}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <div className="cl">
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <Card ic="fileList" title="A. General Information">
          <div className="body gi">
            <Field label="1. Nama Vendor" req>
              <IF ic="building">
                <input
                  list="bp-list"
                  value={v.nama}
                  onChange={(e) => {
                    const val = e.target.value;
                    sv('nama', val);
                    // nama cocok persis dengan Master Supplier & data umum masih kosong: isi otomatis
                    const m = msup.find(
                      (x) => supKey(x.nama) === supKey(val)
                    );
                    if (
                      m &&
                      !v.alamat.trim() &&
                      !v.email.trim() &&
                      !v.npwp.trim() &&
                      !v.pic.trim() &&
                      !v.telp.trim()
                    )
                      applyMaster(m, true);
                  }}
                  placeholder="Masukkan nama vendor"
                />
              </IF>
              <datalist id="bp-list">
                {msup.map((m) => (
                  <option key={m.id} value={m.nama}>
                    {m.npwp || m.pic}
                  </option>
                ))}
                {bps
                  .filter((b) => !msup.some((m) => supKey(m.nama) === supKey(b.nama)))
                  .map((b) => (
                    <option key={b.id} value={b.nama}>
                      {b.kode}
                    </option>
                  ))}
              </datalist>
              {bpWarn}
            </Field>
            <Field label="2. Alamat Vendor" req>
              <IF ic="pin">
                <textarea
                  rows={1}
                  value={v.alamat}
                  onChange={(e) => sv('alamat', e.target.value)}
                  placeholder="Masukkan alamat vendor lengkap"
                />
              </IF>
            </Field>
            <Field label="3. Email Vendor" req>
              <IF ic="mail">
                <input
                  type="email"
                  value={v.email}
                  onChange={(e) => sv('email', e.target.value)}
                  placeholder="contoh@supplier.com"
                />
              </IF>
            </Field>
            <Field label="4. NPWP" req>
              <IF ic="file">
                <input
                  value={v.npwp}
                  onChange={(e) => sv('npwp', e.target.value)}
                  placeholder="Masukkan NPWP vendor"
                />
              </IF>
            </Field>
            <Field label="5. No. Fax (jika ada)">
              <IF ic="printer">
                <input
                  value={v.fax}
                  onChange={(e) => sv('fax', e.target.value)}
                  placeholder="Masukkan nomor fax"
                />
              </IF>
            </Field>
            <Field label="6. Nama PIC Vendor" req>
              <IF ic="user">
                <input
                  value={v.pic}
                  onChange={(e) => sv('pic', e.target.value)}
                  placeholder="Masukkan nama PIC vendor"
                />
              </IF>
            </Field>
            <Field label="7. No. Telepon Vendor" req>
              <IF ic="phone">
                <input
                  value={v.telp}
                  onChange={(e) => sv('telp', e.target.value)}
                  placeholder="021-12345678"
                />
              </IF>
            </Field>
          </div>
        </Card>
        </fieldset>
      </div>
      <div className="cr">
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <Card title="C. Pajak & Discount">
          <div className="body grid3">
            <Field label="1. Pajak" req>
              <select value={tax} onChange={(e) => setTax(e.target.value)}>
                <option value="">Pilih Pajak</option>
                {taxes
                  .filter(
                    (t) =>
                      t.aktif ||
                      Math.round(taxRate(t) * 10000) ===
                        Math.round(Number(tax) * 10000)
                  )
                  .map((t) => (
                    <option key={t.id} value={String(taxRate(t))}>
                      {taxText(t)} ({t.tipe === 'kurang' ? '−' : '+'})
                    </option>
                  ))}
                {tax !== '' &&
                  !taxes.some(
                    (t) =>
                      Math.round(taxRate(t) * 10000) ===
                      Math.round(Number(tax) * 10000)
                  ) && <option value={tax}>{taxName(Number(tax))}</option>}
              </select>
            </Field>
            <Field label="2. Discount (Nominal)">
              <input
                type="number"
                min="0"
                value={disc}
                onChange={(e) => setDisc(e.target.value)}
                placeholder="Rp 0"
              />
            </Field>
            <Field label="3. Ongkir (Nominal)">
              <input
                type="number"
                min="0"
                value={ong}
                onChange={(e) => setOng(e.target.value)}
                placeholder="Rp 0"
              />
            </Field>
            <Field label="4. Grand Total (Otomatis)">
              <input readOnly value={rp(grand)} />
            </Field>
          </div>
        </Card>
        </fieldset>
      </div>
      <div className="cl">
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <Card ic="box" title="B. Detail Barang / Jasa">
          <div className="body">
            <div style={{ marginBottom: 12 }}>
              <Field
                label="Kategori Barang / Jasa (cukup dipilih sekali untuk semua item)"
                req
              >
                <select value={cat} onChange={(e) => pickCat(e.target.value)}>
                  <option value="">Pilih kategori</option>
                  {cat && !activeCats.some((c) => c.name === cat) && (
                    <option value={cat} disabled>
                      {cat} (nonaktif)
                    </option>
                  )}
                  {(['Barang', 'Jasa'] as CatType[]).map(
                    (t) =>
                      activeCats.some((c) => c.type === t) && (
                        <optgroup key={t} label={t}>
                          {activeCats
                            .filter((c) => c.type === t)
                            .map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </optgroup>
                      )
                  )}
                </select>
                <button
                  type="button"
                  className="lnk small"
                  style={{ marginTop: 4 }}
                  onClick={() => setGuide(true)}
                >
                  Bingung pilih kategori? Lihat panduan &amp; contoh
                </button>
                {catObj?.desc && (
                  <div className="mute small" style={{ marginTop: 4 }}>
                    {catObj.desc}. Kebutuhan dengan kategori lain diajukan di PO
                    terpisah.
                  </div>
                )}
              </Field>
            </div>
            {items.map((i, n) => (
              <div className="item" key={i.id}>
                <div className="ihead">
                  <b>Item {n + 1}</b>
                  <button
                    aria-label="Hapus item"
                    title="Hapus item"
                    onClick={() =>
                      items.length > 1
                        ? setItems((l) => l.filter((x) => x.id !== i.id))
                        : notify('Minimal 1 item')
                    }
                  >
                    <Ic n="trash" s={16} />
                  </button>
                </div>
                {(() => {
                  const exs = (catObj?.ex ?? '')
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .map((x) => x.charAt(0).toUpperCase() + x.slice(1));
                  return exs.length ? (
                    <div className="exs">
                      <small>Pilih barang/jasa untuk kategori ini:</small>
                      {exs.map((x) => (
                        <button
                          type="button"
                          key={x}
                          onClick={() => si(i.id, 'd', x)}
                        >
                          {x}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="exs">
                      <small>
                        {cat
                          ? 'Ketik deskripsi barang/jasa di bawah.'
                          : 'Pilih kategori di atas dulu untuk melihat contoh barang/jasa.'}
                      </small>
                    </div>
                  );
                })()}
                <div className="r1">
                  <Field label="1. Description Barang / Jasa" req>
                    <input
                      value={i.d}
                      onChange={(e) => si(i.id, 'd', e.target.value)}
                      placeholder="Masukkan deskripsi barang/jasa"
                    />
                  </Field>
                  <Field label="2. Qty" req>
                    <input
                      type="number"
                      min="0"
                      value={i.q}
                      onChange={(e) => si(i.id, 'q', e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="3. Satuan" req>
                    <select
                      value={i.s}
                      onChange={(e) => si(i.id, 's', e.target.value)}
                    >
                      <option value="">Pilih</option>
                      {UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div
                  className="r2"
                  style={{ gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }}
                >
                  <Field label="4. Unit Price / Harga Satuan (Rp)" req>
                    <input
                      type="number"
                      min="0"
                      value={i.p}
                      onChange={(e) => si(i.id, 'p', e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label="5. Total / Jumlah (Rp)">
                    <input
                      readOnly
                      value={rp((Number(i.q) || 0) * (Number(i.p) || 0))}
                    />
                  </Field>
                </div>
              </div>
            ))}
            <p>
              <button
                className="pri"
                onClick={() =>
                  setItems((l) => [
                    ...l,
                    newItem(
                      catObj?.type === 'Jasa' ? { s: 'Jasa' } : undefined
                    ),
                  ])
                }
              >
                <Ic n="plus" s={16} /> Tambah Item
              </button>
            </p>
          </div>
        </Card>
        </fieldset>
      </div>
      <div className="cr">
        <fieldset
          disabled={readOnly}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <Card ic="card" title="D. Informasi Pembayaran">
          <div className="body grid">
            <Field label="1. No. Rekening" req>
              <input
                value={pay.rek}
                onChange={(e) => sp('rek', e.target.value)}
                placeholder="Masukkan nomor rekening"
                inputMode="numeric"
              />
            </Field>
            <Field label="2. Nama Bank" req>
              <input
                value={pay.bank}
                onChange={(e) => sp('bank', e.target.value)}
                placeholder="Contoh: BCA, Mandiri, BNI"
              />
            </Field>
            <Field label="3. Kantor Cabang" req>
              <input
                value={pay.cabang}
                onChange={(e) => sp('cabang', e.target.value)}
                placeholder="Masukkan kantor cabang"
              />
            </Field>
            <Field label="4. Atas Nama" req>
              <input
                value={pay.an}
                onChange={(e) => sp('an', e.target.value)}
                placeholder="Masukkan nama pemilik rekening"
              />
            </Field>
          </div>
        </Card>

        <div className="card fold">
          <button
            type="button"
            className="fhead"
            onClick={() => setInfoOpen((x) => !x)}
            aria-expanded={infoOpen}
          >
            <Ic n="info" s={20} />
            <b>Informasi Tambahan</b>
            <span className="sp" />
            <Ic n={infoOpen ? 'up' : 'down'} s={18} />
          </button>
          {infoOpen && (
            <div className="body">
              <textarea
                rows={3}
                maxLength={250}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Masukkan catatan atau informasi tambahan jika diperlukan..."
              />
            </div>
          )}
        </div>

        </fieldset>
        {!readOnly && (
        <div className="actions">
          <button
            className="l"
            onClick={() => {
              setV(EMPTY);
              setPay(EMPTY_PAY);
              setItems([newItem()]);
              setTax('');
              setDisc('');
              setOng('');
              setNote('');
            }}
          >
            Reset Form
          </button>
          {onBack && (
            <button className="ghost" onClick={onBack}>
              Batal
            </button>
          )}
          <button className="pri" onClick={send}>
            Kirim Request
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

/* ================= TABEL PO (user & admin) ================= */
function PoTable({
  list,
  onCopy,
  onPrint,
  onDone,
  onReject,
  onReopen,
  lockedOf,
  onResend,
  resendOf,
  onAllowReprint,
  onEdit,
  onNewFrom,
  aksiLabel,
}: {
  list: PO[];
  onCopy: (p: PO, all: boolean) => void;
  onPrint: (no: string) => void;
  onDone?: (no: string) => void;
  onReject?: (no: string) => void;
  onReopen?: (no: string) => void;
  lockedOf?: (p: PO) => boolean;
  onResend?: (p: PO) => void;
  resendOf?: (p: PO) => boolean;
  onAllowReprint?: (no: string) => void;
  onEdit?: (p: PO) => void; // buka form terisi data PO ditolak untuk diperbaiki
  onNewFrom?: (p: PO) => void; // PO Reject final: buat PO baru (nomor baru) dari data PO lama
  aksiLabel?: string; // label kolom terakhir (default 'Aksi')
}) {
  const [open, setOpen] = useState('');
  if (!list.length)
    return <div className="empty">Belum ada data pengajuan.</div>;
  const rows = [...list].sort((a, b) => b.iso.localeCompare(a.iso)); // terbaru di atas
  return (
    <div className="tbl">
      <table>
        <thead>
          <tr>
            <th>No. Pengajuan</th>
            <th>Waktu Submit</th>
            <th>Departemen</th>
            <th>Vendor</th>
            <th>Pemohon</th>
            <th>Total</th>
            <th>Status</th>
            <th>{aksiLabel ?? 'Aksi'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const done = p.status === 'Done';
            const lk = lockedOf?.(p) ?? false;
            const pn = p.printN ?? 0;
            return (
              <Fragment key={p.no}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="lnk"
                      title="Lihat & cetak dokumen PO"
                      onClick={() => onPrint(p.no)}
                    >
                      <b>{p.no}</b>
                    </button>
                    {lk && (
                      <span
                        className="tag s-wait"
                        style={{ marginLeft: 6 }}
                        title="Periode tahun ini terkunci"
                      >
                        🔒
                      </span>
                    )}
                  </td>
                  <td>{fmtDT(p.iso)}</td>
                  <td>{p.dept}</td>
                  <td>{p.v.nama}</td>
                  <td>{p.by}</td>
                  <td className="num">{rp(p.total)}</td>
                  <td>
                    <span
                      className={
                        'tag ' +
                        (p.rej ? 's-rejected' : 's-' + (done ? 'Done' : 'Open'))
                      }
                    >
                      {p.rej ? 'Rejected' : done ? 'Done' : 'Open'}
                    </span>
                    {p.rej && (
                      <div className="note bad">
                        {p.rejFinal ? 'PO Reject' : 'Ditolak'} {fmtDT(p.rej)}
                        {p.rejWhy && (
                          <>
                            <br />
                            Alasan: {p.rejWhy}
                          </>
                        )}
                        {p.rejFinal && (
                          <>
                            <br />
                            <b>
                              {p.newNo
                                ? `Diganti PO baru: ${p.newNo}`
                                : 'PO ini tidak bisa diedit lagi. Buat PO baru (nomor baru).'}
                            </b>
                          </>
                        )}
                      </div>
                    )}
                    {p.prevNo && (
                      <div className="note">Pengganti PO reject {p.prevNo}</div>
                    )}
                    {!p.rej && !done && p.resent && (
                      <div className="note">
                        Dikirim ulang {fmtDT(p.resent)}
                      </div>
                    )}
                    {done && (
                      <div className="note">
                        {p.doneAt ? `Selesai ${fmtDT(p.doneAt)}` : ''}
                        <br />
                        <b>✔ PO sudah bisa dicetak</b>
                        {pn > 0 && (
                          <>
                            <br />
                            <span className="prnote">
                              🖨 Dicetak {pn}×{p.printAt ? ` · terakhir ${fmtDT(p.printAt)}` : ''}
                              {p.printOk ? ' · cetak ulang diizinkan' : ''}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="abtn">
                      {onDone && !lk && !done && !p.rej && (
                        <button className="pri" onClick={() => onDone(p.no)}>
                          Done
                        </button>
                      )}
                      {onReject && !lk && !done && !p.rej && (
                        <button className="cx" onClick={() => onReject(p.no)}>
                          Cancel
                        </button>
                      )}
                      {onNewFrom &&
                        p.rejFinal &&
                        !p.newNo &&
                        !lk &&
                        (resendOf ? resendOf(p) : true) && (
                          <button className="pri" onClick={() => onNewFrom(p)}>
                            Buat PO Baru
                          </button>
                        )}
                      {onResend &&
                        p.rej &&
                        !p.rejFinal &&
                        !lk &&
                        (resendOf ? resendOf(p) : true) && (
                          <button className="pri" onClick={() => onResend(p)}>
                            Kirim Ulang
                          </button>
                        )}
                      {onEdit &&
                        p.rej &&
                        !p.rejFinal &&
                        !lk &&
                        (resendOf ? resendOf(p) : true) && (
                          <button className="ghost" onClick={() => onEdit(p)}>
                            Edit PO
                          </button>
                        )}
                      {onReopen && !lk && !p.rejFinal && (done || p.rej) && (
                        <button
                          className="ghost"
                          onClick={() => onReopen(p.no)}
                        >
                          Buka Lagi
                        </button>
                      )}
                      {done || onDone ? (
                        <button
                          className={
                            'ghost ' +
                            (done ? 'prgreen' : '')
                          }
                          onClick={() => onPrint(p.no)}
                        >
                          Cetak PO
                        </button>
                      ) : (
                        <span className="tipw" data-tip={waitTip(p)}>
                          <button
                            type="button"
                            className="ghost off"
                            aria-disabled="true"
                          >
                            Cetak PO
                          </button>
                        </span>
                      )}
                      {done && (
                        <button
                          className="ghost"
                          title="Unduh PO sebagai PDF (atau cetak langsung)"
                          onClick={() => downloadPoPdf(p)}
                        >
                          ⬇ Download PDF
                        </button>
                      )}
                      <button
                        className="ghost"
                        onClick={() => setOpen(open === p.no ? '' : p.no)}
                      >
                        Detail
                      </button>
                      <button
                        className="ghost"
                        onClick={() => onCopy(p, false)}
                      >
                        Salin Vendor
                      </button>
                      <button className="ghost" onClick={() => onCopy(p, true)}>
                        Salin Semua
                      </button>
                    </div>
                  </td>
                </tr>
                {open === p.no && (
                  <tr>
                    <td colSpan={8} className="detail">
                      <div>
                        <b>{p.v.nama}</b> · PIC {p.v.pic} · {p.v.telp}
                        {p.v.fax && ` · Fax ${p.v.fax}`} · {p.v.email}
                        <br />
                        {p.v.alamat} · NPWP {p.v.npwp}
                      </div>
                      {p.pay && (
                        <div>
                          Pembayaran: {p.pay.bank} · {p.pay.cabang} · No. Rek{' '}
                          {p.pay.rek} a.n. {p.pay.an}
                        </div>
                      )}
                      <ul>
                        {p.items.map((l, n) => (
                          <li key={n}>
                            {l.d} — {l.q} {l.s} × {rp(l.p)} = {rp(l.q * l.p)}
                          </li>
                        ))}
                      </ul>
                      <div>
                        Subtotal {rp(p.sub)} · Discount {rp(p.disc)} · Pajak{' '}
                        {taxName(p.rate)}
                        {p.ong ? ` · Ongkir ${rp(p.ong)}` : ''} ·{' '}
                        <b>Grand Total {rp(p.total)}</b>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ================= PENGATURAN TAMPILAN (admin): logo & background login, logo sidebar ================= */
function BrandSettings({
  brand,
  setBrand,
  notify,
}: {
  brand: Brand;
  setBrand: (f: (b: Brand) => Brand) => void;
  notify: (m: string) => void;
}) {
  const pick = async (f: File | undefined, kind: 'logo' | 'bg' | 'side') => {
    if (!f) return;
    if (!f.type.startsWith('image/'))
      return notify('File harus berupa gambar (PNG/JPG/WebP).');
    if (f.size > 8 * 1024 * 1024) return notify('Ukuran file maksimal 8 MB.');
    try {
      const url =
        kind === 'bg'
          ? await readImage(f, 1800, 'image/jpeg')
          : await readImage(f, 500, 'image/png');
      setBrand((b) => ({ ...b, [kind]: url }));
      notify(
        kind === 'logo'
          ? 'Logo login diperbarui.'
          : kind === 'side'
          ? 'Logo sidebar diperbarui.'
          : 'Background login diperbarui.'
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Gagal memproses gambar');
    }
  };
  const file = (label: string, kind: 'logo' | 'bg' | 'side') => (
    <label className="btnfile">
      {label}
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0], kind);
          e.target.value = '';
        }}
      />
    </label>
  );
  return (
    <Card ic="gear" title="Tampilan Halaman Login & Sidebar">
      <div className="body">
        <p className="mute">
          Logo tampil di tengah atas kartu login (latar putih), disusul tulisan
          “PO Request System”. Background, transparansi kartu, dan logo sidebar
          juga diatur di sini.
        </p>
        <div className="grid3">
          <div>
            <label>Logo login</label>
            <div className="prev logo">
              <img src={brand.logo || LOGO_TIGHT} alt="Logo" />
            </div>
            <div className="acts" style={{ marginTop: 8 }}>
              {file('Unggah logo', 'logo')}
              {brand.logo && (
                <button onClick={() => setBrand((b) => ({ ...b, logo: '' }))}>
                  Kembalikan bawaan
                </button>
              )}
            </div>
          </div>
          <div>
            <label>Background login</label>
            <div
              className="prev bg"
              style={
                brand.bg ? { backgroundImage: `url("${brand.bg}")` } : undefined
              }
            >
              {!brand.bg && <span>Bawaan (gradien biru)</span>}
            </div>
            <div className="acts" style={{ marginTop: 8 }}>
              {file('Unggah background', 'bg')}
              {brand.bg && (
                <button onClick={() => setBrand((b) => ({ ...b, bg: '' }))}>
                  Hapus background
                </button>
              )}
            </div>
          </div>
          <div>
            <label>Logo sidebar (putih/transparan)</label>
            <div className="prev side">
              <SideLogo src={brand.side} box={brand.sideBox} />
            </div>
            <div className="acts" style={{ marginTop: 8 }}>
              {file('Unggah logo sidebar', 'side')}
              {brand.side && (
                <button onClick={() => setBrand((b) => ({ ...b, side: '' }))}>
                  Kembalikan bawaan
                </button>
              )}
            </div>
            <label className="chk">
              <input
                type="checkbox"
                checked={brand.sideBox !== false}
                onChange={(e) =>
                  setBrand((b) => ({ ...b, sideBox: e.target.checked }))
                }
              />
              <span>Tampilkan di kotak putih (mengikuti ukuran logo)</span>
            </label>
            <p className="mute small">
              Logo ini menggantikan tulisan ARGAPURA di sidebar. Matikan centang
              hanya jika logo berupa PNG transparan berwarna putih.
            </p>
          </div>
        </div>
        <div style={{ marginTop: 16, maxWidth: 420 }}>
          <label>Transparansi kartu login: {brand.glass}%</label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={brand.glass}
            onChange={(e) =>
              setBrand((b) => ({ ...b, glass: Number(e.target.value) }))
            }
          />
          <p className="mute small">
            0% = kartu lebih pekat, 100% = hampir bening sehingga background
            terlihat jelas.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ================= HALAMAN-HALAMAN (data diturunkan dari riwayat PO) ================= */
type SupRow = { v: Vendor; pay?: Pay; n: number; total: number; last: string };
const supplierRows = (list: PO[]): SupRow[] => {
  const m = new Map<string, SupRow>();
  [...list]
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .forEach((p) => {
      const k = supKey(p.v.nama);
      const x = m.get(k);
      m.set(k, {
        v: p.v,
        pay: p.pay,
        n: (x?.n ?? 0) + 1,
        total: (x?.total ?? 0) + p.total,
        last: p.iso,
      });
    });
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
};
type PriceHist = { p: number; last: string; qty: number; n: number }; // riwayat per harga: tanggal order terakhir di harga tsb, total qty, jumlah order
type ItemRow = {
  d: string;
  s: string;
  p: number;
  k: string;
  n: number;
  qty: number;
  h: PriceHist[];
};
const itemRows = (list: PO[]): ItemRow[] => {
  const m = new Map<string, ItemRow>();
  [...list]
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .forEach((po) =>
      po.items.forEach((l) => {
        const key = l.d.trim().toLowerCase();
        const x = m.get(key);
        const h = x ? [...x.h] : [];
        const i = h.findIndex((e) => e.p === l.p);
        if (i >= 0)
          h[i] = { p: l.p, last: po.iso, qty: h[i].qty + l.q, n: h[i].n + 1 };
        else h.push({ p: l.p, last: po.iso, qty: l.q, n: 1 });
        m.set(key, {
          d: l.d,
          s: l.s,
          p: l.p,
          k: l.k ?? x?.k ?? '',
          n: (x?.n ?? 0) + 1,
          qty: (x?.qty ?? 0) + l.q,
          h,
        });
      })
    );
  // harga terbaru (order terakhir) paling atas
  m.forEach((r) => r.h.sort((a, b) => b.last.localeCompare(a.last)));
  return [...m.values()].sort((a, b) => b.n - a.n || a.d.localeCompare(b.d));
};

/* Drill-down: seluruh transaksi (supplier, nama barang, harga, tanggal) untuk satu barang/jasa, terbaru di atas */
type ItemTrx = {
  no: string;
  iso: string;
  vendor: string;
  d: string;
  q: number;
  s: string;
  p: number;
};
const itemTrx = (list: PO[], key: string): ItemTrx[] => {
  const o: ItemTrx[] = [];
  list.forEach((po) =>
    po.items.forEach((l) => {
      if (l.d.trim().toLowerCase() === key)
        o.push({
          no: po.no,
          iso: po.iso,
          vendor: po.v.nama,
          d: l.d,
          q: l.q,
          s: l.s,
          p: l.p,
        });
    })
  );
  return o.sort((x, y) => y.iso.localeCompare(x.iso));
};

function SupplierPage({
  list,
  onUse,
}: {
  list: PO[];
  onUse?: (r: SupRow) => void;
}) {
  const [q, setQ] = useState('');
  const rows = supplierRows(list).filter(
    (r) => !q.trim() || r.v.nama.toLowerCase().includes(q.trim().toLowerCase())
  );
  const pg = usePager(rows, 15);
  return (
    <Card ic="users" title="Supplier dari Riwayat PO">
      <div className="body">
        <div className="bar">
          <div className="ifld grow">
            <span className="ico">
              <Ic n="search" s={18} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama supplier..."
            />
          </div>
        </div>
        {!rows.length ? (
          <div className="empty">
            Belum ada data supplier. Supplier tersimpan otomatis dari PO yang
            diajukan.
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>PIC / Kontak</th>
                  <th>Email</th>
                  <th>Jumlah PO</th>
                  <th>Total Nilai</th>
                  <th>PO Terakhir</th>
                  {onUse && <th>Keterangan</th>}
                </tr>
              </thead>
              <tbody>
                {pg.view.map((r) => (
                  <tr key={r.v.nama}>
                    <td>
                      <b>{r.v.nama}</b>
                      <div className="mute small">
                        {r.v.alamat.split('\n')[0]}
                      </div>
                    </td>
                    <td>
                      {r.v.pic}
                      <div className="mute small">{r.v.telp}</div>
                    </td>
                    <td>{r.v.email}</td>
                    <td>{r.n}</td>
                    <td className="num">{rp(r.total)}</td>
                    <td>{fmt(r.last)}</td>
                    {onUse && (
                      <td>
                        <button className="ghost" onClick={() => onUse(r)}>
                          Buat PO
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
          </div>
        )}
      </div>
    </Card>
  );
}

/* Halaman Master Supplier: admin unggah Excel/CSV/PDF, semua user memakainya di Form PO */
function MasterSupplierPage({
  msup,
  setMsup,
  canEdit,
  onUse,
  notify,
}: {
  msup: MSup[];
  setMsup: (f: (l: MSup[]) => MSup[]) => void;
  canEdit: boolean;
  onUse?: (m: MSup) => void;
  notify: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const replace = true; // unggah file = ganti seluruh Master Supplier (data lama hilang)
  const [pv, setPv] = useState<{ name: string; res: MsParse } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const read = async (file?: File | null) => {
    if (!file) return;
    if (!/\.(xlsx|xlsm|xls|csv|pdf)$/i.test(file.name))
      return notify('Format file harus Excel (.xlsx/.xls), CSV, atau PDF.');
    if (file.size > 10 * 1024 * 1024)
      return notify('Ukuran file maksimal 10 MB.');
    setBusy(true);
    try {
      const res = await msReadFile(file);
      if (!res.ok)
        notify(
          'Tidak ada data supplier yang terbaca. Pastikan ada baris judul kolom (Vendor Name, Alamat, NPWP, Phone, PIC, Email, No Rek, Bank, ...).'
        );
      else {
        setPv({ name: file.name, res });
      }
    } catch (e) {
      notify(
        'Gagal membaca file: ' +
          (e instanceof Error ? e.message : 'format tidak dikenali') +
          '. Coba unggah versi Excel.'
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const plan = useMemo(
    () => (pv ? msMerge(msup, pv.res.rows, replace) : null),
    [pv, msup, replace]
  );
  const exist = useMemo(
    () => new Set(msup.map((m) => supKey(m.nama))),
    [msup]
  );
  const save = () => {
    if (!pv || !plan) return;
    if (
      replace &&
      !window.confirm(
        `Ganti seluruh Master Supplier (${msup.length} data) dengan ${plan.list.length} data dari file ini?`
      )
    )
      return;
    setMsup(() => plan.list);
    notify(
      replace
        ? `Master Supplier diganti: ${plan.list.length} supplier. Semua user langsung bisa memakainya.`
        : `Master Supplier disimpan: ${plan.add} baru, ${plan.upd} diperbarui. Semua user langsung bisa memakainya.`
    );
    setPv(null);
  };
  const blank = () => {
    const r = {} as MsRow;
    MS_KEYS.forEach(({ k }) => (r[k] = ''));
    return r;
  };
  const [mf, setMf] = useState<MsRow>(blank);
  const [eid, setEid] = useState('');
  const resetOne = () => {
    setMf(blank());
    setEid('');
  };
  const editOne = (m: MSup) => {
    const r = blank();
    MS_KEYS.forEach(({ k }) => (r[k] = m[k]));
    setMf(r);
    setEid(m.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const saveOne = () => {
    const r = {} as MsRow;
    MS_KEYS.forEach(({ k }) => (r[k] = msTxt(mf[k])));
    if (!r.nama) return notify('Isi Vendor Name.');
    if (msup.some((m) => m.id !== eid && supKey(m.nama) === supKey(r.nama)))
      return notify('Supplier dengan nama ini sudah ada. Gunakan Ubah pada daftar.');
    const miss = msMissing(r);
    if (eid) {
      setMsup((l) => l.map((m) => (m.id === eid ? { ...m, ...r } : m)));
      notify('Supplier diperbarui.');
    } else {
      const base = 'ms-' + hash32(supKey(r.nama)).toString(36);
      setMsup((l) => {
        let id = base;
        for (let c = 2; l.some((m) => m.id === id); c++) id = base + '-' + c;
        return [...l, { id, ...r }];
      });
      notify(
        miss.length
          ? `Supplier ditambahkan (data belum lengkap: ${miss
              .map((k) => MS_KEYS.find((x) => x.k === k)?.l)
              .join(', ')}).`
          : 'Supplier ditambahkan ke Master Supplier dan langsung tersedia untuk semua user.'
      );
    }
    resetOne();
  };
  const del = (m: MSup) => {
    if (window.confirm(`Hapus "${m.nama}" dari Master Supplier?`))
      setMsup((l) => l.filter((x) => x.id !== m.id));
  };
  const delAll = () => {
    if (
      window.confirm(
        `Hapus SELURUH Master Supplier (${msup.length} data)? Tindakan ini tidak bisa dibatalkan.`
      )
    )
      setMsup(() => []);
  };
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return [...msup]
      .filter(
        (m) =>
          !k ||
          (m.nama + ' ' + m.npwp + ' ' + m.pic + ' ' + m.email)
            .toLowerCase()
            .includes(k)
      )
      .sort((a, b) => a.nama.localeCompare(b.nama));
  }, [msup, q]);
  const pg = usePager(rows, 15);
  const incomplete = pv
    ? pv.res.rows.filter((r) => msMissing(r).length).length
    : 0;
  const lack = pv
    ? MS_KEYS.filter((x) => !pv.res.fields.includes(x.k)).map((x) => x.l)
    : [];

  return (
    <Card
      ic="users"
      title={canEdit ? 'Master Supplier (Upload Excel / PDF)' : 'Master Supplier'}
    >
      <div className="body">
        {canEdit ? (
          <>
            <div
              className={'msdrop' + (drag ? ' on' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void read(e.dataTransfer.files?.[0]);
              }}
            >
              <span className="msico">
                <Ic n="download" s={26} />
              </span>
              <div className="mst">
                <b>
                  {busy
                    ? 'Membaca file...'
                    : 'Tarik file ke sini atau pilih file'}
                </b>
                <small>
                  Excel (.xlsx / .xls), CSV, atau PDF dengan kolom: Vendor
                  Name, Alamat, Provinsi, NPWP, Phone, Fax, PIC, Departement,
                  Email, No Rek, Bank, Cabang, Atas nama.
                </small>
              </div>
              <div className="acts">
                <button
                  type="button"
                  className="pri"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Ic n="plus" s={16} /> Pilih File
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    void msTemplate().catch(() =>
                      notify('Template gagal dibuat. Periksa koneksi internet.')
                    )
                  }
                >
                  Unduh Template Excel
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept=".xlsx,.xlsm,.xls,.csv,.pdf"
                onChange={(e) => void read(e.target.files?.[0])}
              />
            </div>
            {pv && plan && (
              <div className="mspv">
                <b>Pratinjau: {pv.name}</b>
                <div className="mschips">
                  <span className="mschip">{pv.res.rows.length} baris terbaca</span>
                  <span className="mschip ok">{plan.add} supplier baru</span>
                  {!replace && (
                    <span className="mschip">{plan.upd} diperbarui</span>
                  )}
                  {!replace && plan.same > 0 && (
                    <span className="mschip">{plan.same} tanpa perubahan</span>
                  )}
                  {incomplete > 0 && (
                    <span className="mschip warn">
                      {incomplete} data belum lengkap
                    </span>
                  )}
                  {pv.res.skipped > 0 && (
                    <span className="mschip warn">
                      {pv.res.skipped} baris tanpa nama dilewati
                    </span>
                  )}
                </div>
                {lack.length > 0 && (
                  <p className="mute small">
                    Kolom tidak ditemukan di file: {lack.join(', ')}.
                  </p>
                )}
                <div className="tbl">
                  <table className="mst-t">
                    <thead>
                      <tr>
                        <th>Vendor</th>
                        <th>NPWP</th>
                        <th>Phone</th>
                        <th>PIC</th>
                        <th>Email</th>
                        <th>Bank / No Rek</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pv.res.rows.slice(0, 8).map((r, i) => (
                        <tr key={i}>
                          <td>
                            <b>{r.nama}</b>
                            <div className="mute small">
                              {[r.alamat, r.provinsi].filter(Boolean).join(', ')}
                            </div>
                          </td>
                          <td>{r.npwp}</td>
                          <td>{r.telp}</td>
                          <td>{r.pic}</td>
                          <td>{r.email}</td>
                          <td>
                            {r.bank}
                            <div className="mute small">{r.rek}</div>
                          </td>
                          <td>
                            {!replace && exist.has(supKey(r.nama))
                              ? 'Update'
                              : 'Baru'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pv.res.rows.length > 8 && (
                  <p className="mute small">
                    ...dan {pv.res.rows.length - 8} baris lainnya.
                  </p>
                )}
                <p className="msmiss small">
                  Menyimpan file ini akan MENGGANTI seluruh Master Supplier
                  ({msup.length} data lama dihapus, diganti {plan.list.length}{' '}
                  data dari file).
                </p>
                <div className="acts" style={{ marginTop: 10 }}>
                  <button type="button" className="pri" onClick={save}>
                    <Ic n="check" s={16} /> Simpan ke Master Supplier
                  </button>
                  <button type="button" onClick={() => setPv(null)}>
                    Batal
                  </button>
                </div>
              </div>
            )}
            <p className="mute small">
              Unggah file akan menimpa seluruh daftar: supplier lama hilang dan
              diganti data dari file. Untuk menambah satu supplier tanpa
              menghapus yang lama, pakai form "Tambah Supplier Manual" di bawah.
              Setelah disimpan, seluruh user bisa memilih supplier ini di Form
              PO dan data umum + pembayaran langsung terisi.
            </p>
            <div className="bpbox">
              <b>{eid ? 'Ubah Supplier' : 'Tambah Supplier Manual'}</b>
              <p className="mute small" style={{ margin: '4px 0 8px' }}>
                General Info Supplier
              </p>
              <div className="grid3">
                {(
                  [
                    ['nama', 'Vendor Name', true],
                    ['alamat', 'Alamat', true],
                    ['provinsi', 'Provinsi', false],
                    ['npwp', 'NPWP', true],
                    ['telp', 'Phone', true],
                    ['fax', 'Fax', false],
                    ['pic', 'PIC', true],
                    ['dept', 'Departemen', false],
                    ['email', 'Email', true],
                  ] as [MKey, string, boolean][]
                ).map(([k, l, r]) => (
                  <Field key={k} label={l} req={r}>
                    <input
                      value={mf[k]}
                      onChange={(e) =>
                        setMf((x) => ({ ...x, [k]: e.target.value }))
                      }
                      placeholder={l}
                    />
                  </Field>
                ))}
              </div>
              <p className="mute small" style={{ margin: '10px 0 8px' }}>
                Pembayaran
              </p>
              <div className="grid3">
                {(
                  [
                    ['rek', 'No Rekening', true],
                    ['bank', 'Bank', true],
                    ['cabang', 'Cabang', true],
                    ['an', 'Atas Nama', true],
                  ] as [MKey, string, boolean][]
                ).map(([k, l, r]) => (
                  <Field key={k} label={l} req={r}>
                    <input
                      value={mf[k]}
                      onChange={(e) =>
                        setMf((x) => ({ ...x, [k]: e.target.value }))
                      }
                      placeholder={l}
                    />
                  </Field>
                ))}
              </div>
              <div className="acts" style={{ marginTop: 10 }}>
                <button type="button" className="pri" onClick={saveOne}>
                  <Ic n={eid ? 'check' : 'plus'} s={16} />{' '}
                  {eid ? 'Simpan Perubahan' : 'Tambah Supplier'}
                </button>
                {(eid || Object.values(mf).some(Boolean)) && (
                  <button type="button" onClick={resetOne}>
                    Batal
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="mute small">
            Master Supplier dikelola admin. Pilih supplier di bawah (atau di
            Form PO) agar data umum dan pembayaran terisi otomatis.
          </p>
        )}
        <div className="bar">
          <div className="ifld grow">
            <span className="ico">
              <Ic n="search" s={18} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama / NPWP / PIC / email..."
            />
          </div>
          {canEdit && msup.length > 0 && (
            <button type="button" className="ghost" onClick={delAll}>
              Hapus Semua
            </button>
          )}
        </div>
        {!rows.length ? (
          <div className="empty">
            {msup.length
              ? 'Tidak ada supplier yang cocok.'
              : canEdit
              ? 'Belum ada Master Supplier. Unggah file Excel/PDF di atas.'
              : 'Master Supplier belum diisi admin.'}
          </div>
        ) : (
          <div className="tbl">
            <table className="mst-t">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>PIC / Kontak</th>
                  <th>Email</th>
                  <th>NPWP</th>
                  <th>Pembayaran</th>
                  <th>Kelengkapan</th>
                  {(canEdit || onUse) && <th>Keterangan</th>}
                </tr>
              </thead>
              <tbody>
                {pg.view.map((m) => {
                  const miss = msMissing(m);
                  return (
                    <tr key={m.id}>
                      <td>
                        <b>{m.nama}</b>
                        <div className="mute small">
                          {[m.alamat, m.provinsi].filter(Boolean).join(', ')}
                        </div>
                      </td>
                      <td>
                        {m.pic}
                        <div className="mute small">{m.telp}</div>
                      </td>
                      <td>{m.email}</td>
                      <td>{m.npwp}</td>
                      <td>
                        {[m.bank, m.cabang].filter(Boolean).join(' · ')}
                        <div className="mute small">
                          {m.rek}
                          {m.an ? ` a.n. ${m.an}` : ''}
                        </div>
                      </td>
                      <td>
                        {miss.length ? (
                          <span className="msmiss">
                            Kurang:{' '}
                            {miss
                              .map((k) => MS_KEYS.find((x) => x.k === k)?.l)
                              .join(', ')}
                          </span>
                        ) : (
                          <span className="msok">Lengkap</span>
                        )}
                      </td>
                      {(canEdit || onUse) && (
                        <td>
                          {onUse && (
                            <button className="ghost" onClick={() => onUse(m)}>
                              Buat PO
                            </button>
                          )}
                          {canEdit && (
                            <button className="ghost" onClick={() => editOne(m)}>
                              Ubah
                            </button>
                          )}
                          {canEdit && (
                            <button className="ghost" onClick={() => del(m)}>
                              Hapus
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
          </div>
        )}
      </div>
    </Card>
  );
}

function BPPage({
  bps,
  setBps,
  canEdit,
  notify,
}: {
  bps: BP[];
  setBps: (f: (b: BP[]) => BP[]) => void;
  canEdit: boolean;
  notify: (m: string) => void;
}) {
  const nextKode = () =>
    'BP-' +
    String(
      bps.reduce((m, b) => {
        const x = /^BP-(\d+)$/i.exec(b.kode.trim());
        return x ? Math.max(m, Number(x[1])) : m;
      }, 0) + 1
    ).padStart(3, '0');
  const [f, setF] = useState({ kode: '', nama: '', exp: '' });
  const [eid, setEid] = useState('');
  const [q, setQ] = useState('');
  const [fs, setFs] = useState('');
  const all = bps.map((b) => ({ b, i: bpInfo(b.exp) }));
  const rows = all
    .filter(
      ({ b, i }) =>
        (!fs || (fs === 'Expired') === i.expired) &&
        (!q.trim() ||
          (b.kode + ' ' + b.nama)
            .toLowerCase()
            .includes(q.trim().toLowerCase()))
    )
    .sort((x, y) => x.b.nama.localeCompare(y.b.nama));
  const pg = usePager(rows, 15);
  const reset = () => {
    setF({ kode: '', nama: '', exp: '' });
    setEid('');
  };
  const save = () => {
    const kode = f.kode.trim().toUpperCase() || nextKode();
    const nama = f.nama.trim();
    if (!nama || !f.exp)
      return notify('Isi nama supplier dan tanggal expired.');
    if (bps.some((b) => b.id !== eid && b.kode === kode))
      return notify('Kode BP sudah dipakai.');
    if (
      bps.some(
        (b) => b.id !== eid && supKey(b.nama) === supKey(nama)
      )
    )
      return notify('Nama supplier BP sudah terdaftar.');
    if (eid)
      setBps((l) =>
        l.map((b) => (b.id === eid ? { ...b, kode, nama, exp: f.exp } : b))
      );
    else
      setBps((l) => [...l, { id: 'bp' + Date.now(), kode, nama, exp: f.exp }]);
    notify(eid ? 'Supplier BP diperbarui.' : 'Supplier BP ditambahkan.');
    reset();
  };
  const edit = (b: BP) => {
    setEid(b.id);
    setF({ kode: b.kode, nama: b.nama, exp: parseExp(b.exp) ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const del = (b: BP) => {
    if (window.confirm(`Hapus supplier BP "${b.nama}"?`))
      setBps((l) => l.filter((x) => x.id !== b.id));
  };
  return (
    <>
      <div className="stats">
        <div className="card stat">
          <span>Total Supplier BP</span>
          <b>{all.length}</b>
        </div>
        <div className="card stat">
          <span>Aktif</span>
          <b>{all.filter((x) => !x.i.expired && !x.i.bad).length}</b>
        </div>
        <div className="card stat">
          <span>Segera Exp (≤ 30 hari)</span>
          <b>{all.filter((x) => x.i.soon).length}</b>
        </div>
        <div className="card stat">
          <span>Expired</span>
          <b>{all.filter((x) => x.i.expired).length}</b>
        </div>
      </div>
      <Card ic="users" title="Supplier BP (Business Partner)">
        <div className="body">
          {canEdit ? (
            <div className="bpbox">
              <b>{eid ? 'Ubah Supplier BP' : 'Tambah Supplier BP'}</b>
              <div className="bpf">
                <Field label="Kode BP">
                  <input
                    value={f.kode}
                    onChange={(e) =>
                      setF((x) => ({ ...x, kode: e.target.value }))
                    }
                    placeholder={nextKode()}
                  />
                </Field>
                <Field label="Nama Supplier BP" req>
                  <input
                    value={f.nama}
                    onChange={(e) =>
                      setF((x) => ({ ...x, nama: e.target.value }))
                    }
                    placeholder="Nama supplier / business partner"
                  />
                </Field>
                <Field label="Tanggal Exp" req>
                  <input
                    type="date"
                    value={f.exp}
                    onChange={(e) =>
                      setF((x) => ({ ...x, exp: e.target.value }))
                    }
                  />
                </Field>
                <div className="acts">
                  <button className="pri" onClick={save}>
                    <Ic n={eid ? 'check' : 'plus'} s={16} />{' '}
                    {eid ? 'Simpan' : 'Tambah'}
                  </button>
                  {(eid || f.nama || f.exp || f.kode) && (
                    <button onClick={reset}>Batal</button>
                  )}
                </div>
              </div>
              <p className="mute small">
                Status otomatis: Aktif selama tanggal expired belum lewat,
                Expired bila sudah lewat.
              </p>
            </div>
          ) : (
            <p className="mute small">
              Data Supplier BP dikelola oleh admin. Gunakan supplier berstatus
              Aktif untuk pengajuan PO.
            </p>
          )}
          <div className="bar">
            <div className="ifld grow">
              <span className="ico">
                <Ic n="search" s={18} />
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari kode / nama supplier BP..."
              />
            </div>
            <select value={fs} onChange={(e) => setFs(e.target.value)}>
              <option value="">Semua status</option>
              <option>Aktif</option>
              <option>Expired</option>
            </select>
          </div>
          {!rows.length ? (
            <div className="empty">Belum ada data Supplier BP.</div>
          ) : (
            <div className="tbl">
              <table className="bpt">
                <thead>
                  <tr>
                    <th>Kode BP</th>
                    <th>Nama Supplier BP</th>
                    <th>Status</th>
                    <th>Tanggal Exp</th>
                    <th>Sisa Waktu</th>
                    {canEdit && <th>Keterangan</th>}
                  </tr>
                </thead>
                <tbody>
                  {pg.view.map(({ b, i }) => (
                    <tr key={b.id}>
                      <td>
                        <b>{b.kode}</b>
                      </td>
                      <td>{b.nama}</td>
                      <td>
                        <span
                          className={
                            'bpst ' +
                            (i.expired ? 'ex' : i.soon || i.bad ? 'so' : 'ak')
                          }
                        >
                          <i />
                          {i.bad
                            ? 'Cek tanggal'
                            : i.expired
                            ? 'Expired'
                            : i.soon
                            ? 'Segera Exp'
                            : 'Aktif'}
                        </span>
                      </td>
                      <td>{fmtD(b.exp)}</td>
                      <td className={i.expired || i.bad ? 'bad' : i.soon ? 'warnt' : ''}>
                        {i.bad
                          ? 'Format tanggal tidak terbaca'
                          : i.expired
                          ? `Lewat ${-i.days} hari`
                          : i.days === 0
                          ? 'Berakhir hari ini'
                          : `${i.days} hari lagi`}
                      </td>
                      {canEdit && (
                        <td>
                          <select
                            className="actsel"
                            value=""
                            aria-label={'Tindakan untuk ' + b.nama}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === 'edit') edit(b);
                              else if (v === 'del') del(b);
                            }}
                          >
                            <option value="">Pilih tindakan…</option>
                            <option value="edit">Edit</option>
                            <option value="del">Delete</option>
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function BarangPage({
  list,
  onUse,
}: {
  list: PO[];
  onUse?: (r: ItemRow) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null); // kunci barang yang sedang di-drill down
  const rows = itemRows(list).filter(
    (r) => !q.trim() || r.d.toLowerCase().includes(q.trim().toLowerCase())
  );
  const pg = usePager(rows, 15);
  useEffect(() => {
    if (!sel) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSel(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sel]);

  const item = sel
    ? itemRows(list).find((r) => r.d.trim().toLowerCase() === sel)
    : undefined;
  if (sel && item) {
    const trx = itemTrx(list, sel);
    const prices = trx.map((t) => t.p);
    const lo = Math.min(...prices),
      hi = Math.max(...prices);
    return (
      <Card ic="box" title="Detail Barang / Jasa">
        <div className="body drill">
          <div className="drhead">
            <button className="ghost back" onClick={() => setSel(null)}>
              <Ic n="left" s={14} /> Kembali
            </button>
            <div className="drttl">
              <b>{item.d}</b>
              <small>
                {item.k || 'Tanpa kategori'} · Satuan {item.s}
              </small>
            </div>
            {onUse && (
              <button className="pri" onClick={() => onUse(item)}>
                Pakai di PO
              </button>
            )}
          </div>
          <div className="drstat">
            <div>
              <small>Jumlah Transaksi</small>
              <b>{trx.length}×</b>
            </div>
            <div>
              <small>Total Qty</small>
              <b>
                {item.qty.toLocaleString('id-ID')} {item.s}
              </b>
            </div>
            <div>
              <small>Harga Terakhir</small>
              <b>{rp(trx[0].p)}</b>
            </div>
            <div>
              <small>Rentang Harga</small>
              <b>{lo === hi ? rp(lo) : rp(lo) + ' – ' + rp(hi)}</b>
            </div>
          </div>
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier / Vendor</th>
                  <th>Nama Barang</th>
                  <th>Harga</th>
                  <th>Qty</th>
                  <th>Tanggal</th>
                  <th>No. Pengajuan</th>
                </tr>
              </thead>
              <tbody>
                {trx.map((t, i) => (
                  <tr key={t.no + i} className={i === 0 ? 'cur' : ''}>
                    <td>{i + 1}</td>
                    <td>
                      <b>{t.vendor}</b>
                    </td>
                    <td>
                      {t.d}
                      {i === 0 && <span className="tnew2">Terbaru</span>}
                    </td>
                    <td className="num">{rp(t.p)}</td>
                    <td>
                      {t.q.toLocaleString('id-ID')} {t.s}
                    </td>
                    <td>{fmt(t.iso)}</td>
                    <td>{t.no}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card ic="box" title="Daftar Barang">
      <div className="body">
        <div className="bar">
          <div className="ifld grow">
            <span className="ico">
              <Ic n="search" s={18} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama barang / jasa..."
            />
          </div>
        </div>
        {!rows.length ? (
          <div className="empty">
            Belum ada barang. Daftar terisi otomatis dari item PO yang diajukan.
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>Barang / Jasa</th>
                  <th>Kategori</th>
                  <th>Satuan</th>
                  <th>Harga Terakhir</th>
                  <th>Dipesan</th>
                  <th>Total Qty</th>
                  {onUse && <th>Keterangan</th>}
                </tr>
              </thead>
              <tbody>
                {pg.view.map((r) => (
                  <tr
                    key={r.d}
                    className="rowlink"
                    tabIndex={0}
                    title="Klik untuk melihat detail transaksi"
                    onClick={() => setSel(r.d.trim().toLowerCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSel(r.d.trim().toLowerCase());
                    }}
                  >
                    <td>
                      <b>{r.d}</b>
                    </td>
                    <td>{r.k || '-'}</td>
                    <td>{r.s}</td>
                    <td className="num">{rp(r.p)}</td>
                    <td>
                      <span className="drlnk">
                        {r.n}× <Ic n="right" s={13} />
                      </span>
                    </td>
                    <td>{r.qty.toLocaleString('id-ID')}</td>
                    {onUse && (
                      <td>
                        <button
                          className="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUse(r);
                          }}
                        >
                          Pakai di PO
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

function KategoriPage({
  cats,
  setCats,
  setPos,
  list,
  canEdit,
  notify,
}: {
  cats: Cat[];
  setCats: (f: (c: Cat[]) => Cat[]) => void;
  setPos: (f: (p: PO[]) => PO[]) => void;
  list: PO[];
  canEdit: boolean;
  notify: (m: string) => void;
}) {
  const [v, setV] = useState('');
  const [vt, setVt] = useState<CatType>('Barang');
  const [vd, setVd] = useState('');
  const [vx, setVx] = useState('');
  const [q, setQ] = useState('');
  const [tf, setTf] = useState<'all' | CatType>('all');
  const [eid, setEid] = useState<string | null>(null); // nama kategori yang sedang diedit
  const [en, setEn] = useState('');
  const [et, setEt] = useState<CatType>('Barang');
  const [ed, setEd] = useState('');
  const [ex, setEx] = useState('');
  const count = (c: string) =>
    list.reduce((a, p) => a + p.items.filter((l) => l.k === c).length, 0);
  const dup = (t: string, except?: string) =>
    cats.some(
      (c) => c.name.toLowerCase() === t.toLowerCase() && c.name !== except
    );
  const add = () => {
    const t = v.trim();
    if (!canEdit || !t) return;
    if (dup(t)) return notify('Kategori sudah ada.');
    setCats((c) => [
      ...c,
      { name: t, type: vt, desc: vd.trim(), ex: vx.trim() },
    ]);
    setV('');
    setVd('');
    setVx('');
    notify(`Kategori "${t}" (${vt}) ditambahkan.`);
  };
  const startEdit = (c: Cat) => {
    setEid(c.name);
    setEn(c.name);
    setEt(c.type);
    setEd(c.desc ?? '');
    setEx(c.ex ?? '');
  };
  const saveEdit = () => {
    const old = eid;
    const t = en.trim();
    if (!canEdit || old === null) return;
    if (!t) return notify('Nama kategori tidak boleh kosong.');
    if (dup(t, old)) return notify('Nama kategori sudah dipakai.');
    const n = count(old);
    if (
      t !== old &&
      n > 0 &&
      !window.confirm(
        `Ganti nama "${old}" menjadi "${t}"? ${n} item PO lama ikut diperbarui.`
      )
    )
      return;
    setCats((l) =>
      l.map((c) =>
        c.name === old
          ? { ...c, name: t, type: et, desc: ed.trim(), ex: ex.trim() }
          : c
      )
    );
    if (t !== old)
      setPos((l) =>
        l.map((p) =>
          p.items.some((i) => i.k === old)
            ? {
                ...p,
                items: p.items.map((i) => (i.k === old ? { ...i, k: t } : i)),
              }
            : p
        )
      );
    setEid(null);
    notify(
      t !== old ? `Kategori diubah menjadi "${t}".` : 'Kategori diperbarui.'
    );
  };
  const del = (c: Cat) => {
    if (!canEdit || count(c.name) > 0) return;
    if (!window.confirm(`Hapus kategori "${c.name}"? (belum pernah dipakai)`))
      return;
    setCats((l) => l.filter((x) => x.name !== c.name));
  };
  const shown = cats
    .map((c, i) => ({ c, no: i + 1 }))
    .filter(
      ({ c }) => !c.off && (tf === 'all' || c.type === tf) && catMatch(c, q)
    );
  const pg = usePager(shown, 15);
  return (
    <Card ic="tag" title="Master Kategori PO">
      <div className="body">
        <p className="mute">
          Pengelompokan kebutuhan barang dan jasa untuk pengajuan Purchase
          Order. Bingung masuk kategori apa? Cari barang/jasa yang akan dibeli
          di kolom pencarian, lihat contohnya, lalu pilih kategori yang sesuai
          di Form PO.{' '}
          {canEdit
            ? 'Admin mengatur nama, tipe, deskripsi, dan contoh kategori.'
            : 'Daftar kategori diatur oleh admin.'}
        </p>
        {canEdit && (
          <div className="bar" style={{ flexWrap: 'wrap' }}>
            <input
              value={v}
              onChange={(e) => setV(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="Nama kategori baru"
            />
            <select
              value={vt}
              onChange={(e) => setVt(e.target.value as CatType)}
              aria-label="Tipe kategori"
            >
              <option>Barang</option>
              <option>Jasa</option>
            </select>
            <input
              value={vd}
              onChange={(e) => setVd(e.target.value)}
              placeholder="Deskripsi"
            />
            <input
              value={vx}
              onChange={(e) => setVx(e.target.value)}
              placeholder="Contoh pengajuan (pisahkan dengan koma)"
            />
            <button className="pri" onClick={add}>
              <Ic n="plus" s={16} /> Tambah
            </button>
          </div>
        )}
        <div className="bar" style={{ flexWrap: 'wrap' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari kategori, deskripsi, atau contoh (mis. laptop, APAR, ekspedisi)..."
            aria-label="Cari kategori"
          />
          <div className="cseg">
            {(['all', 'Barang', 'Jasa'] as const).map((x) => (
              <button
                key={x}
                className={tf === x ? 'on' : ''}
                onClick={() => setTf(x)}
              >
                {x === 'all' ? 'Semua' : x}
              </button>
            ))}
          </div>
        </div>
        <div className="tbl ctbl">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Nama Kategori</th>
                <th>Tipe</th>
                <th>Deskripsi</th>
                <th>Contoh Pengajuan PO</th>
                {canEdit && (
                  <>
                    <th>Item dipesan</th>
                    <th>Keterangan</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {pg.view.map(({ c, no }) => {
                const e = eid === c.name;
                return (
                  <tr
                    key={c.name}
                    style={c.off ? { opacity: 0.65 } : undefined}
                  >
                    <td>{no}</td>
                    <td>
                      {e ? (
                        <input
                          value={en}
                          onChange={(x) => setEn(x.target.value)}
                          onKeyDown={(x) => x.key === 'Enter' && saveEdit()}
                          aria-label="Nama kategori"
                        />
                      ) : (
                        <b>{c.name}</b>
                      )}
                    </td>
                    <td>
                      {e ? (
                        <select
                          value={et}
                          onChange={(x) => setEt(x.target.value as CatType)}
                          aria-label="Tipe kategori"
                        >
                          <option>Barang</option>
                          <option>Jasa</option>
                        </select>
                      ) : (
                        <span
                          className={
                            'tag ' + (c.type === 'Jasa' ? 's-Done' : '')
                          }
                        >
                          {c.type}
                        </span>
                      )}
                    </td>
                    <td>
                      {e ? (
                        <input
                          value={ed}
                          onChange={(x) => setEd(x.target.value)}
                          aria-label="Deskripsi"
                        />
                      ) : (
                        c.desc || '-'
                      )}
                    </td>
                    <td>
                      {e ? (
                        <input
                          value={ex}
                          onChange={(x) => setEx(x.target.value)}
                          aria-label="Contoh pengajuan"
                        />
                      ) : (
                        c.ex || '-'
                      )}
                    </td>
                    {canEdit && (
                      <>
                        <td>{count(c.name)}</td>
                        <td>
                          <div className="acts sm fx">
                            {e ? (
                              <>
                                <button className="pri" onClick={saveEdit}>
                                  Save
                                </button>
                                <button
                                  className="ghost"
                                  onClick={() => setEid(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  className="ghost"
                                  onClick={() => startEdit(c)}
                                >
                                  <Ic n="edit" s={12} /> Edit
                                </button>
                                <button
                                  className="ghost"
                                  disabled={count(c.name) > 0}
                                  title={
                                    count(c.name) > 0
                                      ? 'Sudah dipakai di PO, tidak bisa dihapus'
                                      : 'Hapus kategori'
                                  }
                                  onClick={() => del(c)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={canEdit ? 7 : 5} className="empty">
                    Tidak ada kategori yang cocok
                    {q.trim() ? ` dengan “${q.trim()}”` : ''}. Coba kata kunci
                    lain.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
        </div>
      </div>
    </Card>
  );
}

function HistoryPage({ rows, admin }: { rows: Hist[]; admin: boolean }) {
  const [q, setQ] = useState('');
  const key = q.trim().toLowerCase();
  const list = rows.filter(
    (h) =>
      !key ||
      (h.by + ' ' + h.dept + ' ' + h.no + ' ' + h.what)
        .toLowerCase()
        .includes(key)
  );
  const pg = usePager(list, 15);
  return (
    <Card ic="clock" title="Change History">
      <div className="body">
        <div className="bar">
          <div className="ifld grow">
            <span className="ico">
              <Ic n="search" s={18} />
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari akun / bagian / no. PO / perubahan..."
            />
          </div>
        </div>
        <p className="mute small" style={{ margin: '0 0 8px' }}>
          {admin
            ? 'Semua perubahan dari seluruh akun.'
            : 'Perubahan yang Anda lakukan dan perubahan pada PO milik Anda.'}{' '}
          Terbaru di atas · {list.length} catatan.
        </p>
        {!list.length ? (
          <div className="empty">
            Belum ada riwayat perubahan. Perubahan pengajuan, status, dan
            tracking PO akan tercatat otomatis di sini.
          </div>
        ) : (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>No</th>
                  <th>Akun</th>
                  <th>Tanggal</th>
                  <th>Jam</th>
                  <th>Bagian</th>
                  <th>No. PO</th>
                  <th>Yang Diupdate</th>
                </tr>
              </thead>
              <tbody>
                {pg.view.map((h, i) => (
                  <tr key={h.id}>
                    <td>{(pg.page - 1) * 15 + i + 1}</td>
                    <td>
                      <b>{h.by}</b>
                    </td>
                    <td>
                      {new Date(h.iso).toLocaleDateString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td>
                      {new Date(h.iso).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td>{h.dept || '-'}</td>
                    <td>{h.no}</td>
                    <td>{h.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
          </div>
        )}
      </div>
    </Card>
  );
}

/** Paginasi generik: bagi daftar menjadi halaman-halaman (dipakai Tracking PO & semua tabel). */
function usePager<T>(rows: T[], per: number) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const safe = Math.min(page, pages);
  return { page: safe, pages, view: rows.slice((safe - 1) * per, safe * per), setPage };
}

/** Tombol halaman: Sebelumnya / nomor (jendela di sekitar halaman aktif) / Berikutnya. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums: number[] = [];
  for (let i = 1; i <= pages; i++) nums.push(i);
  const show = nums.filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  return (
    <div className="pager">
      <button type="button" className="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Sebelumnya
      </button>
      <span className="pgnums">
        {show.map((n, i) => (
          <span key={n}>
            {i > 0 && n - show[i - 1] > 1 && <em>…</em>}
            <button
              type="button"
              className={n === page ? 'on' : ''}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          </span>
        ))}
      </span>
      <button type="button" className="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Berikutnya ›
      </button>
    </div>
  );
}

function TrackingPage({
  list,
  me,
  onPrint,
  onSet,
  notify,
  lockedOf,
}: {
  lockedOf: (p: PO) => boolean;
  list: PO[];
  me: User;
  onPrint: (no: string) => void;
  onSet: (no: string, k: TKey, v: string) => void;
  notify: (m: string) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const admin = me.role === 'admin';
  const today = ymd(new Date());
  const key = q.trim().toLowerCase();
  const rows = [...list]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .filter(
      (p) =>
        !key ||
        (p.no + ' ' + p.v.nama + ' ' + p.by + ' ' + p.dept)
          .toLowerCase()
          .includes(key)
    );
  const pg = usePager(rows, 3); // Tracking PO: 3 kartu per halaman
  // Resume monitoring: PO progres terendah (di luar yang rejected), urut dari yang paling tertinggal, 5 per halaman
  const lowAll = [...list]
    .filter((p) => !p.rej)
    .map((p) => ({ p, t: trackOf(p) }))
    .sort((a, b) => a.t.done - b.t.done || b.p.iso.localeCompare(a.p.iso));
  const lowPg = usePager(lowAll, 5);
  if (!list.length)
    return (
      <Card>
        <div className="empty">Belum ada pengajuan untuk dilacak.</div>
      </Card>
    );
  const openNo = sel === '-' ? '' : sel || rows[0]?.no;
  return (
    <>
      <div className="bar">
        <div className="ifld grow">
          <span className="ico">
            <Ic n="search" s={18} />
          </span>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              pg.setPage(1);
            }}
            placeholder="Cari no. PO / vendor / pemohon..."
          />
        </div>
      </div>
      {lowAll.length > 0 && (
        <Card ic="clock" title="Resume — PO progres terendah">
          <div className="body">
            <p className="mute small" style={{ margin: '0 0 8px' }}>
              PO dengan progres terendah (di luar yang rejected), diurutkan dari yang paling tertinggal — 5 per halaman, pantau di tahap apa masing-masing
              berhenti. Klik nomor PO untuk menampilkan kartunya di bawah.
            </p>
            <div className="tbl">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>No. PO</th>
                    <th>Vendor</th>
                    <th>Departemen</th>
                    <th>Pembuat</th>
                    <th>Tanggal</th>
                    <th>Progres</th>
                    <th>Tahap saat ini</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lowPg.view.map(({ p, t }) => (
                    <tr key={p.no}>
                      <td>
                        <button
                          type="button"
                          className="lnk"
                          onClick={() => {
                            setQ(p.no);
                            pg.setPage(1);
                          }}
                        >
                          {p.no}
                        </button>
                      </td>
                      <td>{p.v.nama}</td>
                      <td>{p.dept}</td>
                      <td>{p.by}</td>
                      <td>{fmtD(dayOf(p.iso))}</td>
                      <td>
                        <div className="pbar" style={{ margin: '2px 0' }}>
                          <i style={{ width: `${(t.done / TSTEPS.length) * 100}%` }} />
                        </div>
                        <small>
                          {Math.round((t.done / TSTEPS.length) * 100)}% ({t.done}/{TSTEPS.length} tahap)
                        </small>
                      </td>
                      <td>{t.all ? 'Semua tahap selesai' : TSTEPS[t.cur].l}</td>
                      <td>
                        <span className={'tag ' + (t.all ? 's-Done' : 's-Open')}>
                          {t.all ? 'Selesai' : 'Progress'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager page={lowPg.page} pages={lowPg.pages} onPage={lowPg.setPage} />
            </div>
          </div>
        </Card>
      )}
      {!rows.length && (
        <Card>
          <div className="empty">Tidak ada PO yang cocok.</div>
        </Card>
      )}
      <div className="trkgrid">
      {pg.view.map((p) => {
        const t = trackOf(p);
        const lk = lockedOf(p);
        const isOpen = openNo === p.no;
        return (
          <Card key={p.no} cls={'trkcard' + (isOpen ? ' open' : '')}>
            <div className="body">
              <button
                type="button"
                className="trkhead"
                onClick={() => setSel(isOpen ? '-' : p.no)}
                aria-expanded={isOpen}
              >
                <span className="tl1">
                  <b>{p.no}</b>
                  <small>
                    {p.v.nama} · {p.dept} · {p.by}
                  </small>
                </span>
                <span className="tl2">
                  <span
                    className={
                      'tag ' +
                      (p.rej ? 's-rejected' : t.all ? 's-Done' : 's-Open')
                    }
                  >
                    {p.rej ? 'Rejected' : t.all ? 'Selesai' : 'Progress'}
                  </span>
                  <small>
                    {t.done}/{TSTEPS.length} tahap ·{' '}
                    {t.all ? 'Semua tahap selesai' : TSTEPS[t.cur].l}
                  </small>
                </span>
                <Ic n={isOpen ? 'up' : 'down'} s={18} />
              </button>
              <div className="pbar">
                <i style={{ width: `${(t.done / TSTEPS.length) * 100}%` }} />
              </div>
              {isOpen && (
                <>
                  {lk && (
                    <div className="note bad">
                      🔒 Periode tahun ini terkunci oleh admin, tanggal tahapan
                      tidak bisa diubah.
                    </div>
                  )}
                  <ol className="tl">
                    {TSTEPS.map((s, i) => {
                      const dt = t.dates[i];
                      const st = dt
                        ? 'ok'
                        : i === t.cur && !p.rej
                        ? 'cur'
                        : 'open';
                      // Tanggal "PO dikirim ke supplier" & "Barang diterima" penting: user pembuat PO boleh mengisi/mengubahnya kapan saja (tidak harus menunggu tahap sebelumnya). Tahap milik admin (di-approve, ke kantor pusat, sampai di kantor pusat, pembayaran) juga selalu bisa diisi admin tanpa menunggu giliran
                      const keyStep =
                        s.k === 'supp' || s.k === 'recv' || s.k === 'appr' || s.by === 'admin';
                      const can =
                        !lk &&
                        !p.rej &&
                        s.by !== 'auto' &&
                        (s.by === 'creator'
                          ? p.uid === me.id
                          : s.by === 'both'
                          ? admin || p.uid === me.id
                          : admin) &&
                        (keyStep || !!dt || i === t.cur);
                      const prev = t.dates.slice(0, i).filter(Boolean).pop(); // tanggal terisi terakhir sebelum tahap ini
                      const nx = t.dates.slice(i + 1).find(Boolean); // tanggal terisi pertama sesudah tahap ini
                      const lo = prev ? dayOf(prev) : '';
                      const hi = nx && dayOf(nx) < today ? dayOf(nx) : today;
                      const k = s.k as TKey;
                      const change = (v: string) => {
                        if (!v) return;
                        if (lo && v < lo)
                          return notify(
                            `Tanggal tidak boleh sebelum tahap sebelumnya (${fmtD(
                              lo
                            )}).`
                          );
                        if (v > hi)
                          return notify(
                            nx
                              ? `Tanggal tidak boleh setelah tahap berikutnya (${fmtD(
                                  nx
                                )}).`
                              : 'Tanggal tidak boleh di masa depan.'
                          );
                        onSet(p.no, k, v);
                      };
                      return (
                        <li key={s.k} className={st}>
                          <i>
                            {st === 'ok' ? (
                              <Ic n="check" s={16} />
                            ) : st === 'cur' ? (
                              <Ic n="clock" s={16} />
                            ) : (
                              <span className="dt" />
                            )}
                          </i>
                          <div className="tc">
                            <div className="th">
                              <b>{s.l}</b>
                              <span
                                className={
                                  'tag ' +
                                  (st === 'ok'
                                    ? 's-Done'
                                    : st === 'cur'
                                    ? 's-Open'
                                    : 's-wait')
                                }
                              >
                                {st === 'ok'
                                  ? 'Selesai'
                                  : st === 'cur'
                                  ? 'Progress'
                                  : 'Open'}
                              </span>
                            </div>
                            <small>
                              {dt
                                ? s.k === 'made'
                                  ? fmtDT(dt)
                                  : fmtD(dt)
                                : can
                                ? s.k === 'appr'
                                  ? 'Isi tanggal PO ditandatangani atasan untuk menyelesaikan tahap ini'
                                  : 'Isi tanggal untuk menyelesaikan tahap ini'
                                : st === 'cur'
                                ? s.by === 'creator'
                                  ? `Menunggu update dari pembuat PO (${p.by})`
                                  : s.by === 'both'
                                  ? `Menunggu update dari pembuat PO (${p.by}) atau admin`
                                  : 'Menunggu update dari admin'
                                : 'Belum dimulai'}
                            </small>
                            {can && (
                              <div className="tedit">
                                <input
                                  type="date"
                                  value={dt ? dayOf(dt) : ''}
                                  min={lo || undefined}
                                  max={hi}
                                  onChange={(e) => change(e.target.value)}
                                  aria-label={'Tanggal ' + s.l}
                                />
                                {!!dt && !nx && (
                                  <button
                                    className="ghost"
                                    onClick={() => onSet(p.no, k, '')}
                                  >
                                    Hapus
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="acts">
                    <button className="ghost" onClick={() => onPrint(p.no)}>
                      Lihat dokumen PO
                    </button>
                  </div>
                </>
              )}
            </div>
          </Card>
        );
      })}
      </div>
      <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
    </>
  );
}

/** kunci "sudah dibaca" notifikasi; penolakan baru (setelah kirim ulang) selalu dihitung sebagai notifikasi baru */
const notifKey = (uid: string, p: PO) =>
  p.rej ? `${uid}|${p.no}|x${p.rej}` : `${uid}|${p.no}`;
function NotifPage({
  list,
  seen,
  me,
  onRead,
  onReadAll,
  onPrint,
  onResend,
  onNewFrom,
  lockedOf,
}: {
  list: PO[];
  seen: string[];
  me: string;
  onRead: (no: string) => void;
  onReadAll: () => void;
  onPrint: (no: string) => void;
  onResend: (p: PO) => void;
  onNewFrom: (p: PO) => void;
  lockedOf: (p: PO) => boolean;
}) {
  const rows = [...list].sort((a, b) =>
    (b.rej ?? b.doneAt ?? b.iso).localeCompare(a.rej ?? a.doneAt ?? a.iso)
  );
  return (
    <Card ic="bell" title="Notifikasi">
      <div className="body">
        <div className="bar">
          <button onClick={onReadAll}>Tandai semua dibaca</button>
        </div>
        {!rows.length ? (
          <div className="empty">Belum ada notifikasi.</div>
        ) : (
          rows.map((p) => {
            const done = p.status === 'Done';
            const rej = !!p.rej;
            const unread = (done || rej) && !seen.includes(notifKey(me, p));
            return (
              <Fragment key={p.no}>
                <button
                  type="button"
                  className={'nt' + (unread ? ' un' : '') + (rej ? ' rj' : '')}
                  onClick={() => {
                    onRead(p.no);
                    onPrint(p.no);
                  }}
                >
                  <span className="nti">
                    <Ic n={rej ? 'x' : done ? 'check' : 'clock'} s={18} />
                  </span>
                  <span className="ntt">
                    <b>
                      {rej
                        ? p.rejFinal
                          ? 'PO di-reject admin (final)'
                          : 'Pengajuan ditolak admin'
                        : done
                        ? 'PO sudah bisa dicetak'
                        : 'Pengajuan menunggu diproses'}
                    </b>
                    <small>
                      {p.no} · {p.v.nama} ·{' '}
                      {fmtDT(
                        rej && p.rej
                          ? p.rej
                          : done && p.doneAt
                          ? p.doneAt
                          : p.iso
                      )}
                    </small>
                    {rej && (
                      <small className="ntr">
                        Alasan: {p.rejWhy || 'Ditolak oleh admin'}.{' '}
                        {p.rejFinal
                          ? p.newNo
                            ? `PO ini tidak bisa diedit lagi dan sudah diganti PO baru ${p.newNo}.`
                            : 'PO ini tidak bisa diedit lagi. Tekan Buat PO Baru untuk membuat PO dengan nomor baru.'
                          : 'Anda tidak perlu membuat ulang: tekan Kirim Ulang untuk melanjutkan PO ini setelah admin memperbarui Supplier BP.'}
                      </small>
                    )}
                  </span>
                  {unread && <em className="dot" />}
                </button>
                {rej && !p.rejFinal && !lockedOf(p) && (
                  <div className="ntact">
                    <button
                      type="button"
                      className="pri"
                      onClick={() => onResend(p)}
                    >
                      Kirim Ulang
                    </button>
                  </div>
                )}
                {p.rejFinal && !p.newNo && !lockedOf(p) && (
                  <div className="ntact">
                    <button
                      type="button"
                      className="pri"
                      onClick={() => onNewFrom(p)}
                    >
                      Buat PO Baru
                    </button>
                  </div>
                )}
              </Fragment>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ================= DEPARTEMEN (admin): dipakai di pendaftaran, form PO, filter, dashboard & kode nomor PO ================= */
function DeptSettings({
  depts,
  setDepts,
  users,
  setUsers,
  pos,
  setPos,
  notify,
}: {
  depts: Dept[];
  setDepts: (f: (d: Dept[]) => Dept[]) => void;
  users: User[];
  setUsers: (f: (u: User[]) => User[]) => void;
  pos: PO[];
  setPos: (f: (p: PO[]) => PO[]) => void;
  notify: (m: string) => void;
}) {
  const [f, setF] = useState({ nama: '' });
  const [eid, setEid] = useState(''); // nama lama departemen yang sedang diubah
  const rows = [...depts].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  const uCount = (n: string) =>
    users.filter((u) => u.role === 'user' && u.dept === n).length;
  const pCount = (n: string) => pos.filter((x) => x.dept === n).length;
  const reset = () => {
    setF({ nama: '' });
    setEid('');
  };
  const save = () => {
    const nama = f.nama.trim().replace(/\s+/g, ' ');
    if (!nama) return notify('Isi nama departemen.');
    if (
      depts.some(
        (d) => d.nama !== eid && d.nama.toLowerCase() === nama.toLowerCase()
      )
    )
      return notify('Nama departemen sudah ada.');
    if (eid) {
      setDepts((l) => l.map((d) => (d.nama === eid ? { nama } : d)));
      if (nama !== eid) {
        setUsers((l) =>
          l.map((u) => (u.dept === eid ? { ...u, dept: nama } : u))
        );
        setPos((l) =>
          l.map((x) => (x.dept === eid ? { ...x, dept: nama } : x))
        );
      }
      notify('Departemen diperbarui.');
    } else {
      setDepts((l) => [...l, { nama }]);
      notify('Departemen ditambahkan.');
    }
    reset();
  };
  const edit = (d: Dept) => {
    setEid(d.nama);
    setF({ nama: d.nama });
  };
  const del = (d: Dept) => {
    const u = uCount(d.nama),
      n = pCount(d.nama);
    if (u || n)
      return notify(
        `Departemen masih dipakai ${u} user dan ${n} PO, tidak bisa dihapus.`
      );
    if (depts.length <= 1) return notify('Minimal harus ada 1 departemen.');
    if (window.confirm(`Hapus departemen "${d.nama}"?`))
      setDepts((l) => l.filter((x) => x.nama !== d.nama));
  };
  return (
    <Card ic="building" title="Departemen">
      <div className="body">
        <p className="mute small">
          Daftar ini otomatis dipakai pada pilihan departemen saat pendaftaran,
          filter admin, dan dashboard. Mengubah nama departemen ikut memperbarui
          user dan PO yang sudah ada. Nomor PO tidak memakai kode departemen.
          Departemen yang masih dipakai user atau PO tidak bisa dihapus.
        </p>
        <div className="bpbox">
          <b>{eid ? 'Ubah Departemen' : 'Tambah Departemen'}</b>
          <div className="dpf">
            <Field label="Nama Departemen" req>
              <input
                value={f.nama}
                onChange={(e) => setF((x) => ({ ...x, nama: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="Nama departemen"
              />
            </Field>
            <div className="acts">
              <button className="pri" onClick={save}>
                <Ic n={eid ? 'check' : 'plus'} s={16} />{' '}
                {eid ? 'Simpan' : 'Tambah'}
              </button>
              {(eid || f.nama) && <button onClick={reset}>Batal</button>}
            </div>
          </div>
        </div>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Departemen</th>
                <th>User</th>
                <th>PO</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.nama}>
                  <td>
                    <b>{d.nama}</b>
                  </td>
                  <td>{uCount(d.nama)}</td>
                  <td>{pCount(d.nama)}</td>
                  <td>
                    <div className="acts">
                      <button className="ghost" onClick={() => edit(d)}>
                        Ubah
                      </button>
                      <button className="ghost" onClick={() => del(d)}>
                        Hapus
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

/* ================= PAJAK (admin): daftar pilihan pajak di form PO. PPN menambah total, PPh mengurangi total ================= */
function TaxSettings({
  taxes,
  setTaxes,
  pos,
  notify,
}: {
  taxes: Tax[];
  setTaxes: (f: (t: Tax[]) => Tax[]) => void;
  pos: PO[];
  notify: (m: string) => void;
}) {
  const E = { nama: '', persen: '', tipe: 'tambah' as Tax['tipe'] };
  const [f, setF] = useState(E);
  const [eid, setEid] = useState('');
  const used = (t: Tax) =>
    pos.filter(
      (p) => Math.round(p.rate * 10000) === Math.round(taxRate(t) * 10000)
    ).length;
  const reset = () => {
    setF(E);
    setEid('');
  };
  const save = () => {
    const nama = f.nama.trim().replace(/\s+/g, ' ');
    const persen = Number(String(f.persen).replace(',', '.'));
    if (!nama) return notify('Isi nama pajak, mis. PPN atau PPh 23.');
    if (!(persen > 0 && persen < 100)) return notify('Persen pajak harus antara 0 dan 100.');
    const cand: Tax = { id: eid || 'tx-' + Date.now().toString(36), nama, persen, tipe: f.tipe, aktif: true };
    if (
      taxes.some(
        (t) => t.id !== eid && taxText(t).toLowerCase() === taxText(cand).toLowerCase() && t.tipe === cand.tipe
      )
    )
      return notify('Pajak tersebut sudah ada.');
    if (eid) {
      setTaxes((l) => l.map((t) => (t.id === eid ? { ...cand, aktif: t.aktif } : t)));
      notify('Pajak diperbarui.');
    } else {
      setTaxes((l) => [...l, cand]);
      notify('Pajak ditambahkan.');
    }
    reset();
  };
  const edit = (t: Tax) => {
    setEid(t.id);
    setF({ nama: t.nama, persen: String(t.persen), tipe: t.tipe });
  };
  const toggle = (t: Tax) =>
    setTaxes((l) => l.map((x) => (x.id === t.id ? { ...x, aktif: !x.aktif } : x)));
  const del = (t: Tax) => {
    const n = used(t);
    if (n) return notify(`Pajak dipakai ${n} PO, tidak bisa dihapus. Nonaktifkan saja.`);
    if (window.confirm(`Hapus pajak "${taxText(t)}"?`))
      setTaxes((l) => l.filter((x) => x.id !== t.id));
  };
  return (
    <Card ic="receipt" title="Pajak">
      <div className="body">
        <p className="mute small">
          Daftar ini dipakai pada dropdown "Pajak" di form PO. Jenis <b>PPN</b> menambah
          total, jenis <b>PPh</b> mengurangi total. Pajak yang sudah dipakai PO tidak bisa
          dihapus, cukup dinonaktifkan agar tidak muncul di form.
        </p>
        <div className="bpbox">
          <b>{eid ? 'Ubah Pajak' : 'Tambah Pajak'}</b>
          <div className="dpf">
            <Field label="Nama Pajak" req>
              <input
                value={f.nama}
                onChange={(e) => setF((x) => ({ ...x, nama: e.target.value }))}
                placeholder="mis. PPN / PPh 23"
              />
            </Field>
            <Field label="Persen (%)" req>
              <input
                type="number"
                min="0"
                step="0.01"
                value={f.persen}
                onChange={(e) => setF((x) => ({ ...x, persen: e.target.value }))}
                placeholder="mis. 11"
              />
            </Field>
            <Field label="Jenis" req>
              <select
                value={f.tipe}
                onChange={(e) => setF((x) => ({ ...x, tipe: e.target.value as Tax['tipe'] }))}
              >
                <option value="tambah">PPN (menambah total)</option>
                <option value="kurang">PPh (mengurangi total)</option>
              </select>
            </Field>
            <div className="acts">
              <button className="pri" onClick={save}>
                <Ic n={eid ? 'check' : 'plus'} s={16} /> {eid ? 'Simpan' : 'Tambah'}
              </button>
              {(eid || f.nama || f.persen) && <button onClick={reset}>Batal</button>}
            </div>
          </div>
        </div>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Pajak</th>
                <th>Jenis</th>
                <th>Status</th>
                <th>PO</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {taxes.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b>{taxText(t)}</b>
                  </td>
                  <td>{t.tipe === 'kurang' ? 'PPh · mengurangi (−)' : 'PPN · menambah (+)'}</td>
                  <td>{t.aktif ? 'Aktif' : 'Nonaktif'}</td>
                  <td>{used(t)}</td>
                  <td>
                    <div className="acts">
                      <button className="ghost" onClick={() => edit(t)}>Ubah</button>
                      <button className="ghost" onClick={() => toggle(t)}>
                        {t.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                      <button className="ghost" onClick={() => del(t)}>Hapus</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

/* ================= PENGATURAN PENOMORAN PO & PERIODE TAHUN (admin) ================= */
function NumberSettings({
  pos,
  cfg,
  setCfg,
  notify,
}: {
  pos: PO[];
  cfg: NumCfg;
  setCfg: (f: (c: NumCfg) => NumCfg) => void;
  notify: (m: string) => void;
}) {
  const now = new Date();
  const yr = now.getFullYear();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const nomor = (n: number) => String(n).padStart(3, '0');
  const years = [
    ...new Set<number>([
      yr,
      ...pos.map((p) => new Date(p.iso).getFullYear()),
      ...Object.keys(cfg).map(Number),
    ]),
  ].sort((a, b) => b - a);

  const saveStart = (y: number) => {
    const k = String(y);
    if (lockedYear(cfg, y))
      return notify(
        `Periode ${y} terkunci. Buka kunci dulu untuk mengubah nomor awal.`
      );
    const raw = (draft[k] ?? '').trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1 || n > 999999)
      return notify('Nomor awal harus berupa angka bulat minimal 1.');
    const last = lastSeq(pos, y);
    setCfg((c) => ({ ...c, [k]: { ...c[k], start: n } }));
    setDraft((d) => {
      const x = { ...d };
      delete x[k];
      return x;
    });
    notify(
      n > last
        ? `Nomor awal ${y} diset ke ${nomor(
            n
          )}. PO berikutnya memakai nomor ini.`
        : `Tersimpan, tetapi PO sudah sampai nomor ${nomor(
            last
          )}. Nomor berikutnya tetap ${nomor(last + 1)}.`
    );
  };
  const resetStart = (y: number) => {
    const k = String(y);
    setCfg((c) => ({ ...c, [k]: { ...c[k], start: undefined } }));
    setDraft((d) => {
      const x = { ...d };
      delete x[k];
      return x;
    });
    notify(`Nomor awal ${y} dikembalikan ke bawaan (001).`);
  };
  const toggleLock = (y: number) => {
    const lk = lockedYear(cfg, y);
    if (
      !window.confirm(
        lk
          ? `Buka kunci periode ${y}? PO tahun ${y} bisa diubah lagi.`
          : `Kunci periode ${y}? PO tahun ${y} tidak bisa diubah dan PO baru tidak bisa dibuat selama terkunci.`
      )
    )
      return;
    setCfg((c) => ({ ...c, [String(y)]: { ...c[String(y)], locked: !lk } }));
    notify(lk ? `Periode ${y} dibuka.` : `Periode ${y} dikunci.`);
  };

  return (
    <Card ic="receipt" title="Penomoran PO & Periode Tahun">
      <div className="body">
        <div className="info">
          <Ic n="info" s={20} />
          <span>
            Nomor berikutnya (tahun {yr}):{' '}
            <b>
              {nomor(nextSeq(pos, yr, cfg))}/AGP-PO/{PO_CODE}/
              {ROMAN[now.getMonth()]}/{yr}
            </b>
          </span>
        </div>
        <p className="mute small">
          Format nomor: urut/AGP-PO/GA/bulan romawi (otomatis mengikuti bulan
          pembuatan PO)/tahun pembuatan PO. Semua departemen memakai satu urutan
          nomor yang sama. Nomor awal menentukan angka pertama yang dipakai pada
          tahun tersebut, lalu nomor berikutnya otomatis melanjutkan. Jika sudah
          ada PO bernomor lebih besar dari nomor awal, urutan tetap lanjut dari
          nomor terbesar. Saat tahun berganti, urutan mulai lagi dari 001 dan
          tahun sebelumnya otomatis terkunci supaya riwayat tidak berubah. Admin
          tetap bisa membuka atau mengunci periode kapan saja.
        </p>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Tahun</th>
                <th>Jumlah PO</th>
                <th>Nomor terakhir</th>
                <th>Nomor awal</th>
                <th>Nomor berikutnya</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const k = String(y);
                const lk = lockedYear(cfg, y);
                const last = lastSeq(pos, y);
                const start = cfg[k]?.start;
                return (
                  <tr key={y}>
                    <td>
                      <b>{y}</b>
                      {y === yr && (
                        <span className="tag s-Open" style={{ marginLeft: 6 }}>
                          Berjalan
                        </span>
                      )}
                    </td>
                    <td>
                      {
                        pos.filter((p) => new Date(p.iso).getFullYear() === y)
                          .length
                      }
                    </td>
                    <td>{last ? nomor(last) : '-'}</td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        style={{ width: 110 }}
                        disabled={lk}
                        placeholder="001"
                        value={
                          draft[k] ?? (start !== undefined ? String(start) : '')
                        }
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [k]: e.target.value }))
                        }
                        aria-label={'Nomor awal tahun ' + y}
                      />
                    </td>
                    <td>
                      <b>{lk ? '-' : nomor(nextSeq(pos, y, cfg))}</b>
                    </td>
                    <td>
                      <span className={'tag ' + (lk ? 's-rejected' : 's-Done')}>
                        {lk ? '🔒 Terkunci' : 'Terbuka'}
                      </span>
                    </td>
                    <td>
                      <div className="acts sm">
                        <button
                          className="pri"
                          disabled={lk || draft[k] === undefined}
                          onClick={() => saveStart(y)}
                        >
                          Simpan
                        </button>
                        {start !== undefined && !lk && (
                          <button
                            className="ghost"
                            onClick={() => resetStart(y)}
                          >
                            Reset
                          </button>
                        )}
                        {lk ? (
                          <button
                            className="ghost"
                            title="Buka kunci agar nomor awal & PO tahun ini bisa diedit lagi"
                            onClick={() => toggleLock(y)}
                          >
                            <Ic n="edit" s={12} /> Edit
                          </button>
                        ) : (
                          <button
                            className="ghost"
                            onClick={() => toggleLock(y)}
                          >
                            Kunci periode
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function SettingsPage({
  changePw,
  me,
  setUsers,
  brand,
  setBrand,
  notify,
  pos,
  numCfg,
  setNumCfg,
  depts,
  setDepts,
  setPos,
  users,
  taxes,
  setTaxes,
}: {
  taxes: Tax[];
  setTaxes: (f: (t: Tax[]) => Tax[]) => void;
  changePw: (o: string, n: string) => Promise<string>;
  depts: Dept[];
  setDepts: (f: (d: Dept[]) => Dept[]) => void;
  setPos: (f: (p: PO[]) => PO[]) => void;
  users: User[];
  pos: PO[];
  numCfg: NumCfg;
  setNumCfg: (f: (c: NumCfg) => NumCfg) => void;
  me: User;
  setUsers: (f: (u: User[]) => User[]) => void;
  brand: Brand;
  setBrand: (f: (b: Brand) => Brand) => void;
  notify: (m: string) => void;
}) {
  const [oldp, setOldp] = useState('');
  const [newp, setNewp] = useState('');
  const admin = me.role === 'admin';
  const change = async () => {
    const err = await changePw(oldp, newp);
    if (err) return notify(err);
    setOldp('');
    setNewp('');
    notify('Password diperbarui.');
  };
  return (
    <>
      <Card ic="user" title="Profil">
        <div className="body">
          <div className="kvi">
            <div>
              <span>
                <Ic n="user" s={18} />
                Nama
              </span>
              <b>{me.nama}</b>
            </div>
            <div>
              <span>
                <Ic n="user" s={18} />
                Username
              </span>
              <b>{uname(me)}</b>
            </div>
            <div>
              <span>
                <Ic n="mail" s={18} />
                Email
              </span>
              <b>{me.email}</b>
            </div>
            <div>
              <span>
                <Ic n="building" s={18} />
                Departemen
              </span>
              <b>{admin ? 'Administrator' : me.dept}</b>
            </div>
          </div>
        </div>
      </Card>
      {!admin && (
        <Card ic="gear" title="Ubah Password">
          <div className="body grid">
            <Field label="Password lama">
              <input
                type="password"
                value={oldp}
                onChange={(e) => setOldp(e.target.value)}
              />
            </Field>
            <Field label="Password baru (min. 6 karakter)">
              <input
                type="password"
                value={newp}
                onChange={(e) => setNewp(e.target.value)}
              />
              <PwMeter n={newp} track="rgba(10,40,90,.15)" />
            </Field>
            <div>
              <button className="pri" onClick={change}>
                Simpan password
              </button>
            </div>
          </div>
        </Card>
      )}
      {admin && (
        <DeptSettings
          depts={depts}
          setDepts={setDepts}
          users={users}
          setUsers={setUsers}
          pos={pos}
          setPos={setPos}
          notify={notify}
        />
      )}
      {admin && (
        <TaxSettings taxes={taxes} setTaxes={setTaxes} pos={pos} notify={notify} />
      )}
      {admin && (
        <NumberSettings
          pos={pos}
          cfg={numCfg}
          setCfg={setNumCfg}
          notify={notify}
        />
      )}
      {admin && (
        <BrandSettings brand={brand} setBrand={setBrand} notify={notify} />
      )}
    </>
  );
}

/* ================= DASHBOARD ================= */
const mkey = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const mlabel = (idx: number) =>
  new Date(Math.floor(idx / 12), idx % 12, 1).toLocaleDateString('id-ID', {
    month: 'short',
    year: 'numeric',
  });
const MONTHS_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
type PType = 'yearly' | 'semester' | 'quarterly' | 'monthly' | 'weekly';
type PSel = { type: PType; year: number; n: number } | null;
type PerSel = NonNullable<PSel>;
const PTYPES: { k: PType; l: string }[] = [
  { k: 'yearly', l: 'Annual / Yearly' },
  { k: 'semester', l: 'Semester / Half-Yearly' },
  { k: 'quarterly', l: 'Quarterly' },
  { k: 'monthly', l: 'Monthly' },
  { k: 'weekly', l: 'Weekly' },
];
const isoW1 = (y: number) => {
  const j = new Date(y, 0, 4);
  return new Date(y, 0, 4 - ((j.getDay() + 6) % 7));
};
const weeksIn = (y: number) =>
  Math.round((isoW1(y + 1).getTime() - isoW1(y).getTime()) / (7 * 86400000));
const pMax = (t: PType, y: number) =>
  t === 'yearly'
    ? 1
    : t === 'semester'
    ? 2
    : t === 'quarterly'
    ? 4
    : t === 'monthly'
    ? 12
    : weeksIn(y);
const pRange = (p: PerSel): { from: number; to: number } => {
  const { type: t, year: y, n } = p;
  if (t === 'yearly')
    return {
      from: new Date(y, 0, 1).getTime(),
      to: new Date(y + 1, 0, 1).getTime(),
    };
  if (t === 'semester')
    return {
      from: new Date(y, (n - 1) * 6, 1).getTime(),
      to: new Date(y, n * 6, 1).getTime(),
    };
  if (t === 'quarterly')
    return {
      from: new Date(y, (n - 1) * 3, 1).getTime(),
      to: new Date(y, n * 3, 1).getTime(),
    };
  if (t === 'monthly')
    return {
      from: new Date(y, n, 1).getTime(),
      to: new Date(y, n + 1, 1).getTime(),
    };
  const w = isoW1(y);
  return {
    from: new Date(
      w.getFullYear(),
      w.getMonth(),
      w.getDate() + (n - 1) * 7
    ).getTime(),
    to: new Date(w.getFullYear(), w.getMonth(), w.getDate() + n * 7).getTime(),
  };
};
const prevPer = (p: PerSel): PerSel => {
  const { type: t, year: y, n } = p;
  if (t === 'yearly') return { type: t, year: y - 1, n: 1 };
  if (n > 1) return { type: t, year: y, n: n - 1 };
  return { type: t, year: y - 1, n: pMax(t, y - 1) };
};
const fmtPD = (ms: number) =>
  new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const pItem = (t: PType, y: number, n: number) => {
  if (t === 'yearly') return String(y);
  if (t === 'semester')
    return `Semester ${n} (${n === 1 ? 'Jan – Jun' : 'Jul – Des'})`;
  if (t === 'quarterly')
    return `Q${n} (${MONTHS_ID[(n - 1) * 3].slice(0, 3)} – ${MONTHS_ID[
      n * 3 - 1
    ].slice(0, 3)})`;
  if (t === 'monthly') return MONTHS_ID[n];
  const r = pRange({ type: t, year: y, n });
  return `Minggu ${n} (${fmtPD(r.from)} – ${fmtPD(r.to - 86400000)})`;
};
const pLabel = (p: PerSel) => {
  const { type: t, year: y, n } = p;
  if (t === 'yearly') return `Tahun ${y}`;
  if (t === 'semester') return `Semester ${n} ${y}`;
  if (t === 'quarterly') return `Q${n} ${y}`;
  if (t === 'monthly') return mlabel(y * 12 + n);
  return `Minggu ${n} ${y}`;
};
const defN = (t: PType, y: number) => {
  const now = new Date(),
    max = pMax(t, y);
  if (y !== now.getFullYear()) return 1;
  if (t === 'yearly') return 1;
  if (t === 'semester') return now.getMonth() < 6 ? 1 : 2;
  if (t === 'quarterly') return Math.floor(now.getMonth() / 3) + 1;
  if (t === 'monthly') return now.getMonth();
  return Math.min(
    max,
    Math.max(
      1,
      Math.floor(
        (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
          isoW1(y).getTime()) /
          (7 * 86400000)
      ) + 1
    )
  );
};
const fixPer = (t: PType, y: number, n: number): PerSel => ({
  type: t,
  year: y,
  n:
    t === 'monthly'
      ? Math.min(11, Math.max(0, n))
      : Math.min(pMax(t, y), Math.max(1, n)),
});
const short = (n: number, d = 0) => {
  const f = (x: number) =>
    x.toLocaleString('id-ID', { maximumFractionDigits: d });
  if (n >= 1e9) return `Rp ${f(n / 1e9)} M`;
  if (n >= 1e6) return `Rp ${f(n / 1e6)} jt`;
  if (n >= 1e3) return `Rp ${f(n / 1e3)} rb`;
  return `Rp ${f(n)}`;
};
type Dl = { t: string; tone: 'good' | 'bad' | 'flat' };
const dl = (
  a: number,
  b: number,
  o: { pct?: boolean; upBad?: boolean }
): Dl => {
  const diff = a - b;
  const sym = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
  const tone = diff === 0 ? 'flat' : diff > 0 === !!o.upBad ? 'bad' : 'good';
  if (!o.pct) return { t: `${sym} ${Math.abs(diff)}`, tone };
  if (!b)
    return a
      ? { t: 'Baru', tone: o.upBad ? 'bad' : 'good' }
      : { t: '→ 0%', tone: 'flat' };
  return { t: `${sym} ${Math.abs(Math.round((diff / b) * 100))}%`, tone };
};

/** teks yang mengecil otomatis bila lebih lebar dari kotaknya, agar angka tampil penuh (ukuran dasar dari font induknya) */
function Fit({ text, children }: { text: string; children: ReactNode }) {
  const ghost = useRef<HTMLSpanElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const g = ghost.current,
      host = g?.parentElement;
    if (!g || !host) return;
    const calc = () => {
      const avail = host.clientWidth,
        need = g.offsetWidth;
      setK(
        avail > 0 && need > avail
          ? Math.max(0.4, Math.floor((avail / need) * 100) / 100)
          : 1
      );
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(host);
    return () => ro.disconnect();
  }, [text]);
  return (
    <>
      <span ref={ghost} className="fitg" aria-hidden="true">
        {text}
      </span>
      <span style={{ fontSize: `${k * 100}%` }}>{children}</span>
    </>
  );
}

/** satu baris isi yang diperkecil otomatis (zoom) bila lebih lebar dari kotaknya, sehingga tidak terpotong */
function FitBox({
  children,
  min = 0.45,
}: {
  children: ReactNode;
  min?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current,
      i = inner.current;
    if (!o || !i) return;
    const calc = () => {
      i.style.zoom = '1';
      const need = i.offsetWidth,
        avail = o.clientWidth;
      i.style.zoom =
        need > avail && avail > 0
          ? String(Math.max(min, Math.floor((avail / need) * 100) / 100))
          : '1';
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(o);
    void document.fonts?.ready.then(calc);
    return () => ro.disconnect();
  });
  return (
    <div className="fitbox" ref={outer}>
      <div className="fitin" ref={inner}>
        {children}
      </div>
    </div>
  );
}

/** angka yang menghitung naik dari 0 saat muncul */
function Num({ to, f }: { to: number; f: (n: number) => string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setV(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      setV(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{f(Math.round(v))}</>;
}

function DCard({
  ic,
  title,
  sub,
  right,
  big,
  children,
}: {
  ic: string;
  title: string;
  sub?: string;
  right?: ReactNode;
  big?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card dcard">
      <div className={'dh' + (big ? ' big' : '')}>
        <span className="dic">
          <Ic n={ic} s={big ? 26 : 17} />
        </span>
        {sub ? (
          <div className="dht2">
            <h3>{title}</h3>
            <p>{sub}</p>
          </div>
        ) : (
          <h3>{title}</h3>
        )}
        {right && <span className="dr">{right}</span>}
      </div>
      <div className="db">{children}</div>
    </div>
  );
}

/** jalur batang dengan sudut atas membulat, dasar rata */
const barPath = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${
    x + w
  },${y} ${x + w},${y + rr}V${y + h}Z`;
};

/** campur warna hex dengan putih (t = 0..1) */
const lite = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v + (255 - v) * t);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** grafik batang (nilai PO) + garis (jumlah PO) bergaya kaca berkilau. Batang tumbuh dari bawah, garis tergambar. */
function TrendChart({
  data,
  sel,
  onPick,
  avgSub,
}: {
  data: { l: string; t: number; n: number; m: number }[];
  sel: number | null;
  onPick: (m: number | null) => void;
  avgSub: string;
}) {
  const act = sel === null ? -1 : data.findIndex((d) => d.m === sel); // bar bulan yang sedang menjadi filter
  const rest = act >= 0 ? act : data.length - 1;
  const [hv, setHv] = useState(rest);
  useEffect(() => {
    setHv(rest);
  }, [rest]);
  const W = 640,
    H = 300,
    L = 70,
    R = 44,
    T = 42,
    B = 32;
  const pw = W - L - R,
    ph = H - T - B;
  // sumbu kiri: nilai PO
  const mx = Math.max(...data.map((d) => d.t));
  const raw = (mx > 0 ? mx : 4e6) / 4;
  const ex = Math.pow(10, Math.floor(Math.log10(raw)));
  const fr = raw / ex;
  const step =
    (fr <= 1 ? 1 : fr <= 2 ? 2 : fr <= 2.5 ? 2.5 : fr <= 5 ? 5 : 10) * ex;
  const top = step * 4;
  // sumbu kanan: jumlah PO (kelipatan bulat)
  const nmx = Math.max(1, ...data.map((d) => d.n));
  const nraw = nmx / 4;
  const nex = Math.pow(10, Math.floor(Math.log10(nraw)));
  const nfr = nraw / nex;
  const nstep = Math.max(1, (nfr <= 1 ? 1 : nfr <= 2 ? 2 : nfr <= 5 ? 5 : 10) * nex);
  const mn = nstep * 4;
  const bw = pw / data.length;
  const bwid = Math.min(64, bw * 0.72);
  const X = (i: number) => L + bw * (i + 0.5);
  const Yt = (v: number) => T + ph - (v / top) * ph;
  const Yn = (v: number) => T + ph - (v / mn) * ph;
  const pts = data.map((d, i) => [X(i), Yn(d.n)] as const);
  const path = pts
    .map(([x, y], i) => {
      if (!i) return `M${x},${y}`;
      const py = pts[i - 1][1];
      const mid = (pts[i - 1][0] + x) / 2;
      return `C${mid},${py} ${mid},${y} ${x},${y}`;
    })
    .join('');
  // ringkasan: tertinggi / rata-rata (total / jumlah bulan) / terendah (dari bulan yang ada PO-nya)
  const nz = data.filter((d) => d.t > 0);
  const hi = nz.length ? nz.reduce((a, b) => (b.t > a.t ? b : a)) : null;
  const lo = nz.length ? nz.reduce((a, b) => (b.t < a.t ? b : a)) : null;
  const tot = data.reduce((a, d) => a + d.t, 0);
  const mLbl = (m: number) =>
    new Date(Math.floor(m / 12), m % 12, 1).toLocaleDateString('id-ID', {
      month: 'short',
      year: 'numeric',
    });
  const cc = (c: string) => ({ '--c': c } as CSSProperties);
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend"
        role="group"
        aria-label="Tren nilai PO. Klik bulan untuk memfilter dashboard"
        onMouseLeave={() => setHv(rest)}
      >
        <defs>
          <linearGradient id="tbA" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9eaff" stopOpacity=".97" />
            <stop offset="1" stopColor="#a6ccf8" stopOpacity=".6" />
          </linearGradient>
          <linearGradient id="tbS" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#52a9f8" />
            <stop offset="1" stopColor="#1456c8" />
          </linearGradient>
          <linearGradient id="tgl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".85" />
            <stop offset=".45" stopColor="#fff" stopOpacity=".14" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tsd" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity=".6" />
            <stop offset=".3" stopColor="#fff" stopOpacity="0" />
            <stop offset=".85" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity=".28" />
          </linearGradient>
          <linearGradient id="tpn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".66" />
            <stop offset="1" stopColor="#e6f1ff" stopOpacity=".2" />
          </linearGradient>
          <linearGradient id="tsh" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset=".5" stopColor="#fff" stopOpacity=".6" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="tpg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".9" />
            <stop offset="1" stopColor="#fff" stopOpacity=".55" />
          </linearGradient>
          <clipPath id="tclip">
            <rect x={L - 8} y={T - 14} width={pw + 16} height={ph + 26} rx={18} />
          </clipPath>
          <filter id="tglow" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        <text x={L - 8} y={16} className="axt">
          Nilai PO (Rp Juta)
        </text>
        <text x={W - R + 14} y={16} textAnchor="end" className="axt">
          Jumlah PO
        </text>

        {/* panel kaca di belakang plot */}
        <rect
          x={L - 8}
          y={T - 14}
          width={pw + 16}
          height={ph + 26}
          rx={18}
          fill="url(#tpn)"
          stroke="#fff"
          strokeOpacity=".9"
        />
        <path
          d={`M${L - 8},${T + 30}V${T + 4}Q${L - 8},${T - 14} ${L + 10},${T - 14}H${
            L + pw - 2
          }Q${L + pw + 8},${T - 14} ${L + pw + 8},${T + 4}V${T + 30}Q${
            L + pw / 2
          },${T + 8} ${L - 8},${T + 30}Z`}
          fill="#fff"
          opacity=".28"
        />

        {[0, 1, 2, 3, 4].map((k) => {
          const y = T + ph - (ph * k) / 4;
          return (
            <g key={k}>
              <line
                x1={L}
                x2={W - R}
                y1={y}
                y2={y}
                stroke="#b9d3f0"
                strokeOpacity={k ? 0.75 : 0.9}
                strokeDasharray={k ? '3 4' : undefined}
              />
              <text x={L - 14} y={y + 3.5} textAnchor="end" className="ax">
                {k ? short(step * k, 1) : 'Rp 0'}
              </text>
              <text x={W - R + 14} y={y + 3.5} className="ax">
                {nstep * k}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          if (d.t <= 0) return null;
          const x = X(i) - bwid / 2,
            y = Yt(d.t),
            h = T + ph - y,
            on = i === hv || i === act;
          const p = barPath(x, y, bwid, h, 10);
          const tall = h >= 26;
          let ly = tall ? y + 16 : y - 5;
          if (tall && Math.abs(Yn(d.n) - (ly - 4)) < 13) ly = Yn(d.n) + 17;
          ly = Math.min(ly, T + ph - 6);
          return (
            <g
              key={'b' + i}
              className="gbar"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <path
                d={p}
                fill={on ? 'url(#tbS)' : 'url(#tbA)'}
                stroke="#fff"
                strokeOpacity=".85"
                strokeWidth={1}
              />
              <path d={p} fill="url(#tgl)" opacity={on ? 0.5 : 1} />
              <path d={p} fill="url(#tsd)" />
              <text
                x={X(i)}
                y={ly}
                textAnchor="middle"
                className="bv"
                fill={on && tall ? '#fff' : '#2a5ca8'}
              >
                {short(d.t, 1)}
              </text>
            </g>
          );
        })}

        {/* kilau kaca yang menyapu panel */}
        <g clipPath="url(#tclip)" style={{ pointerEvents: 'none' }}>
          <rect
            className="tshine"
            x={L - 130}
            y={T - 16}
            width={90}
            height={ph + 30}
            fill="url(#tsh)"
          />
        </g>

        <path
          d={path}
          className="gline"
          pathLength={1}
          fill="none"
          stroke="#4d9cff"
          strokeOpacity=".32"
          strokeWidth={8}
          strokeLinecap="round"
          filter="url(#tglow)"
        />
        <path
          d={path}
          className="gline"
          pathLength={1}
          fill="none"
          stroke="#1b4fbf"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
        {pts.map(([x, y], i) => (
          <g
            key={'d' + i}
            className="gdot"
            style={{ animationDelay: `${500 + i * 120}ms` }}
          >
            <circle
              cx={x}
              cy={y}
              r={i === hv ? 6.2 : 5}
              fill="#1b4fbf"
              stroke="#fff"
              strokeWidth={2}
            />
            <circle
              cx={x - 1.3}
              cy={y - 1.5}
              r={1.5}
              fill="#fff"
              opacity=".75"
            />
          </g>
        ))}

        {data.map((d, i) => {
          const w = 30,
            x = X(i) - w / 2,
            y = Math.max(3, Yn(d.n) - 33),
            on = i === hv;
          return (
            <g
              key={'p' + i}
              className="gtip"
              style={{ animationDelay: `${700 + i * 90}ms` }}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={20}
                rx={7}
                fill="url(#tpg)"
                stroke={on ? '#1b4fbf' : '#b4cff0'}
                strokeWidth={on ? 1.4 : 1}
              />
              <text
                x={x + w / 2}
                y={y + 14}
                textAnchor="middle"
                className="tt3"
              >
                {d.n}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => (
          <text
            key={'x' + i}
            x={X(i)}
            y={H - 9}
            textAnchor="middle"
            className="ax"
            style={i === act ? { fontWeight: 700, fill: '#0f5fc0' } : undefined}
          >
            {d.l}
          </text>
        ))}
        {data.map((_, i) => (
          <rect
            key={'h' + i}
            x={L + bw * i}
            y={T - 14}
            width={bw}
            height={ph + 26}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            aria-pressed={i === act}
            aria-label={`Filter bulan ${data[i].l}`}
            onMouseEnter={() => setHv(i)}
            onClick={() => onPick(data[i].m === sel ? null : data[i].m)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onPick(data[i].m === sel ? null : data[i].m);
              }
            }}
          />
        ))}
      </svg>
      <div className="tstats">
        <div className="ts">
          <span className="tl">
            <i style={cc('#22b573')} />
            Tertinggi
          </span>
          <b>{hi ? short(hi.t, 1) : '—'}</b>
          <small>{hi ? mLbl(hi.m) : '—'}</small>
        </div>
        <div className="ts">
          <span className="tl">
            <i style={cc('#f5b82e')} />
            Rata-rata
          </span>
          <b>{short(tot / Math.max(1, data.length), 1)}</b>
          <small>{avgSub}</small>
        </div>
        <div className="ts">
          <span className="tl">
            <i style={cc('#ef4a5a')} />
            Terendah
          </span>
          <b>{lo ? short(lo.t, 1) : '—'}</b>
          <small>{lo ? mLbl(lo.m) : '—'}</small>
        </div>
        <div className="ts tot">
          <span className="tico">
            <Ic n="chart" s={22} />
          </span>
          <span className="tb">
            <span className="tl2">Total Nilai PO</span>
            <b>{short(tot, 1)}</b>
            <small>{data.length} Bulan</small>
          </span>
        </div>
      </div>
    </>
  );
}

type StSeg = { l: string; n: number; c: string; d: string; ic: string };

/** donut kaca: cincin tebal berkilau, label persen di luar cincin, total di tengah */
function Donut({ segs, total }: { segs: StSeg[]; total: number }) {
  const cx = 150,
    cy = 140,
    r = 76,
    sw = 34;
  const live = total > 0 ? segs.filter((x) => x.n > 0) : [];
  let a0 = 0;
  const arcs = live.map((x, i) => {
    const len = (x.n / total) * 100;
    const o = { ...x, i, from: a0, len, mid: a0 + len / 2 };
    a0 += len;
    return o;
  });
  const rot = `rotate(-90 ${cx} ${cy})`;
  return (
    <svg
      viewBox="0 0 300 272"
      className="donut2"
      role="img"
      aria-label="Status pengajuan PO"
    >
      <defs>
        {arcs.map((a) => (
          <linearGradient key={a.i} id={'dg' + a.i} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={lite(a.c, 0.45)} />
            <stop offset=".6" stopColor={a.c} />
            <stop offset="1" stopColor={a.c} />
          </linearGradient>
        ))}
        <linearGradient id="dgl" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".04" />
          <stop offset="1" stopColor="#fff" stopOpacity=".2" />
        </linearGradient>
        <radialGradient id="dhalo" cx=".5" cy=".38" r=".75">
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset="1" stopColor="#cfe3fa" stopOpacity=".28" />
        </radialGradient>
        <radialGradient id="dcen" cx=".35" cy=".28" r=".95">
          <stop offset="0" stopColor="#fff" stopOpacity=".98" />
          <stop offset="1" stopColor="#d9e9fc" stopOpacity=".8" />
        </radialGradient>
        <linearGradient id="dcg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="dcc">
          <circle cx={cx} cy={cy} r={r - sw / 2 - 3} />
        </clipPath>
        <filter id="dsb" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <mask id="dmask">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#fff"
            strokeWidth={sw + 8}
            pathLength={100}
            className="dreveal"
            transform={rot}
          />
        </mask>
      </defs>
      <circle
        cx={cx}
        cy={cy}
        r={r + sw / 2 + 6}
        fill="url(#dhalo)"
        stroke="#fff"
        strokeOpacity=".9"
        strokeWidth={1.5}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={total > 0 ? '#fff' : '#d6e6f8'}
        strokeOpacity={total > 0 ? 0.5 : 1}
        strokeWidth={sw}
      />
      <g mask="url(#dmask)">
        {arcs.map((a) => {
          const d = Math.max(a.len - 0.9, 0.1);
          return (
            <circle
              key={a.i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={`url(#dg${a.i})`}
              strokeWidth={sw}
              pathLength={100}
              strokeDasharray={`${d} ${100 - d}`}
              strokeDashoffset={-a.from}
              transform={rot}
            />
          );
        })}
        {total > 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="url(#dgl)"
            strokeWidth={sw}
          />
        )}
        <circle
          cx={cx}
          cy={cy}
          r={r + sw / 2 - 1}
          fill="none"
          stroke="#fff"
          strokeOpacity=".9"
          strokeWidth={1.6}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r - sw / 2 + 1}
          fill="none"
          stroke="#fff"
          strokeOpacity=".75"
          strokeWidth={1.4}
        />
      </g>
      {total > 0 && (
        <g className="dspin" style={{ pointerEvents: 'none' }}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#fff"
            strokeOpacity=".8"
            strokeWidth={sw}
            pathLength={100}
            strokeDasharray="4 96"
            filter="url(#dsb)"
            transform={rot}
          />
        </g>
      )}
      <circle
        cx={cx}
        cy={cy}
        r={r - sw / 2 - 3}
        fill="url(#dcen)"
        stroke="#fff"
        strokeWidth={1.5}
      />
      <g clipPath="url(#dcc)">
        <ellipse
          cx={cx}
          cy={cy - 30}
          rx={44}
          ry={24}
          fill="url(#dcg)"
          opacity=".7"
        />
      </g>
      <text x={cx} y={cy + 8} className="dn">
        {total}
      </text>
      <text x={cx} y={cy + 30} className="dl">
        Total PO
      </text>
      {arcs.map((a) => {
        const t = (a.mid / 100) * Math.PI * 2,
          sn = Math.sin(t),
          cs = Math.cos(t),
          rl = r + sw / 2 + 17,
          x = cx + rl * sn,
          y = cy - rl * cs,
          anc = sn > 0.25 ? 'start' : sn < -0.25 ? 'end' : 'middle',
          y0 = cs > 0.5 ? y - 16 : cs < -0.5 ? y + 10 : y - 2;
        return (
          <g
            key={'l' + a.i}
            className="gtip"
            style={{ animationDelay: `${900 + a.i * 120}ms` }}
          >
            <text x={x} y={y0} textAnchor={anc} className="dp" fill={a.c}>
              {Math.round((a.n / total) * 100)}%
            </text>
            <text x={x} y={y0 + 13} textAnchor={anc} className="dq">
              ({a.n} PO)
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** isi kartu Status Pengajuan PO: donut, legenda berikon, dan informasi tambahan */
function StatusBody({
  segs,
  total,
  info,
}: {
  segs: StSeg[];
  total: number;
  info: {
    avg: string;
    chip: Dl | null;
    vs: string;
    apprV: number;
    waitV: number;
    totV: number;
  };
}) {
  const pc = (v: number) => (info.totV ? Math.round((v / info.totV) * 100) : 0);
  return (
    <>
      <div className="stwrap">
        <Donut segs={segs} total={total} />
        <ul className="stleg">
          {segs.map((x) => (
            <li key={x.l}>
              <i
                className="dot"
                style={{
                  background: `radial-gradient(circle at 35% 30%, ${lite(
                    x.c,
                    0.55
                  )}, ${x.c} 70%)`,
                }}
              />
              <span className="lt">
                <b>{x.l}</b>
                <small>{x.d}</small>
              </span>
              <span className="lv">
                <b>{x.n}</b>
                <small>({total ? Math.round((x.n / total) * 100) : 0}%)</small>
              </span>
              <span
                className="lic"
                style={{
                  color: x.c,
                  background: `linear-gradient(145deg,${x.c}38,${x.c}14)`,
                }}
              >
                <Ic n={x.ic} s={20} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sinfo">
        <h4>
          <span>
            <Ic n="grid" s={15} />
          </span>
          Informasi Tambahan
        </h4>
        <div className="sgrid">
          <div className="sc">
            <div className="sh">
              <span className="si">
                <Ic n="clock" s={20} />
              </span>
              Rata-rata Waktu Approval
            </div>
            <b>{info.avg}</b>
            <small>
              {info.chip && (
                <em className={'chip ' + info.chip.tone}>{info.chip.t}</em>
              )}
              {info.vs}
            </small>
          </div>
          <div className="sc">
            <div className="sh">
              <span className="si">
                <Ic n="fileList" s={20} />
              </span>
              Nilai PO Disetujui
            </div>
            <b>{short(info.apprV, 1)}</b>
            <span className="pgb">
              <i
                style={{
                  width: `${pc(info.apprV)}%`,
                  background: 'linear-gradient(90deg,#4ddc9c,#16a263)',
                }}
              />
            </span>
            <small>{pc(info.apprV)}% dari total nilai PO</small>
          </div>
          <div className="sc">
            <div className="sh">
              <span className="si">
                <Ic n="coins" s={20} />
              </span>
              Nilai PO Menunggu
            </div>
            <b>{short(info.waitV, 1)}</b>
            <span className="pgb">
              <i
                style={{
                  width: `${pc(info.waitV)}%`,
                  background: 'linear-gradient(90deg,#ffd45e,#f0a014)',
                }}
              />
            </span>
            <small>{pc(info.waitV)}% dari total nilai PO</small>
          </div>
        </div>
      </div>
    </>
  );
}

function Dashboard({
  list,
  me,
  admin,
  per,
  onPrint,
  onAll,
  onPer,
  deptList,
  cats: catList,
}: {
  onPer: (p: PSel) => void;
  cats: Cat[];
  deptList: string[];
  list: PO[];
  me: User;
  admin: boolean;
  per: PSel;
  onPrint: (no: string) => void;
  onAll: (f: string) => void;
}) {
  const [ctype, setCtype] = useState<'all' | CatType>('all');
  const now = Date.now();
  const inM = (p: PO, m: number) => mkey(new Date(p.iso)) === m;
  const mi = per && per.type === 'monthly' ? per.year * 12 + per.n : null;
  const inR = (p: PO, r: { from: number; to: number }) => {
    const t = new Date(p.iso).getTime();
    return t >= r.from && t < r.to;
  };
  const pp = per ? prevPer(per) : null;
  const cur = per === null ? list : list.filter((p) => inR(p, pRange(per)));
  const prv = pp === null ? [] : list.filter((p) => inR(p, pRange(pp)));
  const sum = (a: PO[]) => ({
    n: a.length,
    appr: a.filter((p) => !p.rej && isAppr(p)).length,
    rej: a.filter((p) => p.rej).length,
    wait: a.filter(isWait).length,
    v: a.reduce((x, p) => x + nomOf(p), 0),
  });
  const c = sum(cur),
    pv = sum(prv);
  const waitAt = (p: PO, t: number) => {
    if (new Date(p.iso).getTime() > t) return false;
    const ap = p.doneAt ? new Date(p.doneAt).getTime() : Infinity;
    return ap > t && (p.rej ? new Date(p.rej).getTime() : Infinity) > t;
  };
  const wWeek = cur.filter((p) => waitAt(p, now - 7 * 86400000)).length;
  const vs = pp === null ? 'Semua periode' : `vs ${pLabel(pp)}`;
  // rata-rata waktu approval (hari) dari PO yang sudah disetujui
  const apprTs = (p: PO) =>
    p.doneAt ? new Date(p.doneAt).getTime() : Infinity;
  const avgAppr = (a: PO[]) => {
    const xs = a
      .filter((p) => !p.rej && isAppr(p))
      .map((p) => (apprTs(p) - new Date(p.iso).getTime()) / 86400000)
      .filter((x) => isFinite(x))
      .map((x) => Math.max(0, x));
    return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  };
  const avgC = avgAppr(cur);
  const avgP = pp === null ? null : avgAppr(prv);
  let avgChip: Dl | null = null;
  if (avgC !== null && avgP !== null && avgP > 0) {
    const dd = Math.round(((avgC - avgP) / avgP) * 100);
    avgChip = {
      t: `${dd < 0 ? '▼' : dd > 0 ? '▲' : '▬'} ${dd > 0 ? '+' : ''}${dd}%`,
      tone: dd < 0 ? 'good' : dd > 0 ? 'bad' : 'flat',
    };
  }
  const apprV = cur
    .filter((p) => !p.rej && isAppr(p))
    .reduce((x, p) => x + nomOf(p), 0);
  const waitV = cur.filter(isWait).reduce((x, p) => x + nomOf(p), 0);
  const kpis: {
    ic: string;
    g: string;
    l: string;
    v: number;
    f: (n: number) => string;
    d: Dl | null;
    sub: string;
  }[] = [
    {
      ic: 'fileList',
      g: 'linear-gradient(145deg,#3a96ee,#1a62c8)',
      l: 'Total Pengajuan',
      v: c.n,
      f: String,
      d: per === null ? null : dl(c.n, pv.n, { pct: true }),
      sub: vs,
    },
    {
      ic: 'clock',
      g: 'linear-gradient(145deg,#ffc94d,#f09a14)',
      l: 'Menunggu Approval',
      v: c.wait,
      f: String,
      d: dl(c.wait, wWeek, { upBad: true }),
      sub: 'dari minggu lalu',
    },
    {
      ic: 'check',
      g: 'linear-gradient(145deg,#3fd090,#16a263)',
      l: 'Approved',
      v: c.appr,
      f: String,
      d: per === null ? null : dl(c.appr, pv.appr, { pct: true }),
      sub: vs,
    },
    {
      ic: 'x',
      g: 'linear-gradient(145deg,#ff7a86,#e03546)',
      l: 'Rejected',
      v: c.rej,
      f: String,
      d: per === null ? null : dl(c.rej, pv.rej, { upBad: true }),
      sub: vs,
    },
    {
      ic: 'coins',
      g: 'linear-gradient(145deg,#a98bf5,#7048dc)',
      l: 'Total Nilai PO',
      v: c.v,
      f: rp,
      d: per === null ? null : dl(c.v, pv.v, { pct: true }),
      sub: vs,
    },
  ];

  // Jendela tren: kalau periode = semester, tampilkan tepat 6 bulan semester itu
  // (S1 = Jan–Jun, S2 = Jul–Des); kalau tidak, jendela 6 bulan tetap berakhir di
  // bulan ini, sehingga klik bar tidak menggeser grafik; bulan lama yang dipilih
  // dari dropdown tetap tampil di awal jendela.
  const nowK = mkey(new Date());
  const sem = per && per.type === 'semester' ? per : null;
  const base = sem
    ? sem.year * 12 + (sem.n - 1) * 6 + 5
    : mi === null || (mi >= nowK - 5 && mi <= nowK)
    ? nowK
    : mi < nowK - 5
    ? mi + 5
    : mi;
  const trend = Array.from({ length: 6 }, (_, i) => {
    const idx = base - 5 + i;
    const a = list.filter((p) => inM(p, idx));
    return {
      l: new Date(Math.floor(idx / 12), idx % 12, 1).toLocaleDateString(
        'id-ID',
        { month: 'short' }
      ),
      t: a.reduce((x, p) => x + nomOf(p), 0),
      n: a.length,
      m: idx,
    };
  });

  const cm = new Map<string, number>();
  const typeOf = new Map(catList.map((x) => [x.name, x.type] as const));
  cur.forEach((p) =>
    p.items.forEach((l) => {
      if (p.rej) return;
      if (
        ctype !== 'all' &&
        (!l.k || (typeOf.get(l.k) ?? guessType(l.k)) !== ctype)
      )
        return;
      const k = l.k || 'Tanpa Kategori';
      cm.set(k, (cm.get(k) ?? 0) + l.q * l.p);
    })
  );
  const cats = [...cm].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const cmax = cats[0]?.[1] || 1;

  const depts = admin ? deptList : [me.dept];
  const dRows = depts
    .map((d) => {
      const a = cur.filter((p) => p.dept === d);
      return { d, n: a.length, t: a.reduce((x, p) => x + nomOf(p), 0) };
    })
    .sort((x, y) => y.t - x.t || x.d.localeCompare(y.d, 'id'));

  const sm = new Map<string, { nama: string; n: number; t: number }>();
  cur.forEach((p) => {
    const k = supKey(p.v.nama);
    const x = sm.get(k);
    sm.set(k, { nama: p.v.nama, n: (x?.n ?? 0) + 1, t: (x?.t ?? 0) + nomOf(p) });
  });
  const sups = [...sm.values()].sort((a, b) => b.t - a.t).slice(0, 10);

  const recent = [...cur]
    .sort((a, b) => b.iso.localeCompare(a.iso))
    .slice(0, 5);
  const waiting = list
    .filter(isWait)
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(0, 5);
  const days = (iso: string) =>
    Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86400000));
  const pill = (p: PO) =>
    p.rej
      ? ['Rejected', 's-rejected']
      : isAppr(p)
      ? ['Approved', 's-Done']
      : ['Menunggu', 's-Open'];
  const link = (txt: string, f: string) => (
    <button type="button" className="vall" onClick={() => onAll(f)}>
      {txt} <Ic n="right" s={13} />
    </button>
  );
  const none = <div className="empty">Belum ada data pada periode ini.</div>;
  const k = per ? `${per.type}-${per.year}-${per.n}` : 'all';
  const nowY = new Date().getFullYear();
  const minY = Math.min(
    nowY - 1,
    ...list.map((p) => new Date(p.iso).getFullYear()).filter((y) => isFinite(y))
  );
  const years = Array.from({ length: nowY - minY + 1 }, (_, i) => nowY - i);
  const setYear = (v: string) => {
    if (v === 'all') return onPer(null);
    const y = Number(v);
    onPer(
      per
        ? fixPer(per.type, y, per.n)
        : { type: 'monthly', year: y, n: defN('monthly', y) }
    );
  };
  const setType = (t: PType) => {
    const y = per ? per.year : nowY;
    onPer({ type: t, year: y, n: defN(t, y) });
  };
  const nOpts =
    per && per.type !== 'yearly'
      ? Array.from({ length: pMax(per.type, per.year) }, (_, i) => {
          const n = per.type === 'monthly' ? i : i + 1;
          return { n, l: pItem(per.type, per.year, n) };
        })
      : [];

  return (
    <div className="dash">
      <div className="dhead">
        <span className="dhic">
          <Ic n="chart" s={26} />
        </span>
        <div className="dht">
          <h2>PO Request Dashboard</h2>
          <p>Monitoring Pengajuan PO secara Real-Time</p>
        </div>
        <div className="dper">
          <Ic n="calendar" s={16} />
          <span>Periode :</span>
          <label className="dsel">
            <select
              value={per ? String(per.year) : 'all'}
              onChange={(e) => setYear(e.target.value)}
              aria-label="Tahun"
            >
              <option value="all">Semua periode</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Ic n="down" s={14} />
          </label>
          {per && (
            <label className="dsel">
              <select
                value={per.type}
                onChange={(e) => setType(e.target.value as PType)}
                aria-label="Tipe periode"
              >
                {PTYPES.map((t) => (
                  <option key={t.k} value={t.k}>
                    {t.l}
                  </option>
                ))}
              </select>
              <Ic n="down" s={14} />
            </label>
          )}
          {per && per.type !== 'yearly' && (
            <label className="dsel">
              <select
                value={per.n}
                onChange={(e) => onPer({ ...per, n: Number(e.target.value) })}
                aria-label="Pilih periode"
              >
                {nOpts.map((o) => (
                  <option key={o.n} value={o.n}>
                    {o.l}
                  </option>
                ))}
              </select>
              <Ic n="down" s={14} />
            </label>
          )}
        </div>
        <div className="dupd">
          <Ic n="clock" s={18} />
          <span>
            <small>Last Update</small>
            <b>
              {new Date(now).toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}{' '}
              {new Date(now)
                .toLocaleTimeString('id-ID', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
                .replace('.', ':')}{' '}
              WIB
            </b>
          </span>
        </div>
      </div>
      <div className="kpis" key={'k' + k}>
        {kpis.map((x, i) => (
          <div
            className={'card kpi k' + (i + 1)}
            key={x.l}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="kic" style={{ background: x.g }}>
              <Ic n={x.ic} s={20} />
            </span>
            <div className="kb">
              <small>{x.l}</small>
              <b>
                <Fit text={x.f(x.v)}>
                  <Num to={x.v} f={x.f} />
                </Fit>
              </b>
              <div className="kd">
                {x.d && <em className={x.d.tone}>{x.d.t}</em>}
                <span>{x.sub}</span>
              </div>
            </div>
            <span className="kbars" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        ))}
      </div>

      <div className="drow dtop" key={'c' + k}>
        <DCard
          big
          ic="chart"
          title={
            sem
              ? `Tren Nilai PO (${pLabel(sem)})`
              : 'Tren Nilai PO (6 Bulan Terakhir)'
          }
          sub="Perbandingan Nilai dan Jumlah PO per Bulan"
          right={
            <span className="lg2">
              <span>
                <i />
                <em>
                  Nilai PO<small>(Rp Juta)</small>
                </em>
              </span>
              <span>
                <i className="ln" />
                <em>
                  Jumlah PO<small>(Dokumen)</small>
                </em>
              </span>
            </span>
          }
        >
          <TrendChart
            data={trend}
            sel={mi}
            avgSub={sem ? pLabel(sem) : '6 Bulan Terakhir'}
            onPick={(m) =>
              onPer(
                m === null
                  ? null
                  : { type: 'monthly', year: Math.floor(m / 12), n: m % 12 }
              )
            }
          />
          <div className="trfoot">
            <Ic n="filter" s={16} />
            <span>
              {per === null ? (
                'Klik bar bulan untuk memfilter seluruh dashboard.'
              ) : mi === null ? (
                <>
                  Filter aktif: <b>{pLabel(per)}</b>. Klik bar bulan untuk
                  beralih ke filter bulanan.
                </>
              ) : (
                <>
                  Filter aktif: <b>{pLabel(per)}</b>. Klik bulan yang sama lagi
                  untuk kembali ke semua periode.
                </>
              )}
            </span>
          </div>
        </DCard>
        <DCard
          big
          ic="clock"
          title="Status Pengajuan PO"
          sub="Total pengajuan pada periode yang dipilih"
          right={
            <label className="ppill">
              <Ic n="calendar" s={16} />
              <span>{per ? pLabel(per) : 'Semua periode'}</span>
              {per && per.type !== 'yearly' && (
                <>
                  <Ic n="down" s={14} />
                  <select
                    value={per.n}
                    onChange={(e) => onPer({ ...per, n: Number(e.target.value) })}
                    aria-label="Pilih periode"
                  >
                    {nOpts.map((o) => (
                      <option key={o.n} value={o.n}>
                        {o.l}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </label>
          }
        >
          <StatusBody
            total={c.n}
            segs={[
              {
                l: 'Approved',
                n: c.appr,
                c: '#22b573',
                d: 'Telah disetujui dan diproses',
                ic: 'check',
              },
              {
                l: 'Menunggu Approval',
                n: c.wait,
                c: '#f5b82e',
                d: 'Sedang dalam proses persetujuan',
                ic: 'clock',
              },
              {
                l: 'Rejected',
                n: c.rej,
                c: '#ef4a5a',
                d: 'Tidak disetujui / dibatalkan',
                ic: 'x',
              },
            ]}
            info={{
              avg:
                avgC === null
                  ? '—'
                  : `${avgC.toLocaleString('id-ID', {
                      maximumFractionDigits: 1,
                    })} hari`,
              chip: avgChip,
              vs: pp === null ? 'Semua periode' : `dibanding ${pLabel(pp)}`,
              apprV,
              waitV,
              totV: c.v,
            }}
          />
        </DCard>
      </div>

      <div className="drow" key={'g' + k}>
        <DCard ic="box" title="Top 10 Kategori Barang/Jasa">
          <div className="cseg" role="tablist" aria-label="Filter tipe">
            {(['all', 'Barang', 'Jasa'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={ctype === t}
                className={ctype === t ? 'on' : ''}
                onClick={() => setCtype(t)}
              >
                {t === 'all' ? 'Semua' : t}
              </button>
            ))}
          </div>
          {!cats.length ? (
            none
          ) : (
            <div className="ccols">
              {cats.map(([n, v], i) => (
                <div className="crow" key={n}>
                  <span className="cn" title={n}>
                    {n}
                  </span>
                  <span className="cb">
                    <i
                      style={{
                        width: `${Math.max(4, (v / cmax) * 100)}%`,
                        background: `linear-gradient(90deg,#0f5fc0,#2f9be0)`,
                        opacity: Math.max(0.4, 1 - i * 0.07),
                        animationDelay: `${i * 90}ms`,
                      }}
                    />
                  </span>
                  <span className="cv">{rp(v)}</span>
                </div>
              ))}
            </div>
          )}
        </DCard>
      </div>

      <div className="drow d2" key={'t' + k}>
        <DCard ic="building" title="Pengajuan per Departemen">
          <div className="tbl" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="dtbl">
              <thead>
                <tr>
                  <th>Departemen</th>
                  <th>Jumlah PO</th>
                  <th>Total Nilai</th>
                  <th>Persentase</th>
                </tr>
              </thead>
              <tbody>
                {dRows.map((r, i) => {
                  const pc = c.v ? Math.round((r.t / c.v) * 100) : 0;
                  return (
                    <tr key={r.d}>
                      <td>
                        <span className="dpn">
                          <span className="dpi">
                            <Ic n="users" s={14} />
                          </span>
                          {r.d}
                        </span>
                      </td>
                      <td>{r.n}</td>
                      <td className="num">{rp(r.t)}</td>
                      <td>
                        <div className="pc">
                          <span className="cb">
                            <i
                              style={{
                                width: `${pc}%`,
                                background:
                                  'linear-gradient(90deg,#1596d6,#40a8ef)',
                                animationDelay: `${i * 70}ms`,
                              }}
                            />
                          </span>
                          <span>{pc}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DCard>
        <DCard
          ic="users"
          title="Top 10 Supplier (Nilai PO)"
          right={link('Lihat Semua', '')}
        >
          {!sups.length ? (
            none
          ) : (
            <div className="tbl">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Jumlah PO</th>
                    <th>Total Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {sups.map((x, i) => (
                    <tr key={x.nama}>
                      <td>
                        <span className="ell">
                          <span className={'rk g' + (i + 1)}>{i + 1}</span>
                          {x.nama}
                        </span>
                      </td>
                      <td>{x.n}</td>
                      <td className="num">{rp(x.t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DCard>
      </div>

      <div className="drow d2" key={'r' + k}>
        <DCard
          ic="fileList"
          title="Pengajuan Terbaru"
          right={link('Lihat Semua', '')}
        >
          {!recent.length ? (
            none
          ) : (
            <div className="tbl">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>No. Pengajuan</th>
                    <th>Tanggal</th>
                    <th>Supplier</th>
                    <th>Departemen</th>
                    <th>Nilai</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => {
                    const [t, cl] = pill(p);
                    return (
                      <tr key={p.no}>
                        <td>
                          <button
                            type="button"
                            className="lnk"
                            onClick={() => onPrint(p.no)}
                          >
                            {p.no}
                          </button>
                        </td>
                        <td>{fmt(p.iso)}</td>
                        <td>
                          <span className="ell">{p.v.nama}</span>
                        </td>
                        <td>{p.dept}</td>
                        <td className="num">{rp(p.total)}</td>
                        <td>
                          <span className={'tag ' + cl}>{t}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DCard>
        <DCard
          ic="clock"
          title="Menunggu Approval"
          right={link('Lihat Semua', 'Open')}
        >
          {!waiting.length ? (
            <div className="empty">
              Tidak ada pengajuan yang menunggu approval.
            </div>
          ) : (
            <div className="tbl">
              <table className="dtbl">
                <thead>
                  <tr>
                    <th>No. Pengajuan</th>
                    <th>Tanggal</th>
                    <th>Departemen</th>
                    <th>Nilai</th>
                    <th>Lama Menunggu</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((p) => {
                    const d = days(p.iso);
                    return (
                      <tr key={p.no}>
                        <td>
                          <button
                            type="button"
                            className="lnk"
                            onClick={() => onPrint(p.no)}
                          >
                            {p.no}
                          </button>
                        </td>
                        <td>{fmt(p.iso)}</td>
                        <td>{p.dept}</td>
                        <td className="num">{rp(p.total)}</td>
                        <td>
                          <span
                            className={
                              'lm ' + (d >= 4 ? 'c' : d >= 2 ? 'b' : 'a')
                            }
                          >
                            {d === 0 ? 'Hari ini' : `${d} hari`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DCard>
      </div>
    </div>
  );
}

/* ================= HALAMAN SEMUA PENGAJUAN (admin) ================= */
const monthRange = () => {
  const n = new Date();
  return {
    from: ymd(new Date(n.getFullYear(), n.getMonth(), 1)),
    to: ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
  };
};
const ymdLabel = (s: string, empty: string) =>
  s
    ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : empty;
const poState = (p: PO) =>
  p.rej ? 'Rejected' : p.status === 'Done' ? 'Done' : 'Open';
/** Batas nilai PO: di atas Rp 10 juta wajib approve Managing Director. */
const PO_LIMIT = 10_000_000;
/** Nominal untuk dashboard: PO yang di-Reject tidak dihitung (PO yang di-Cancel sudah tidak ada di daftar). */
const nomOf = (p: PO) => (p.rej ? 0 : p.total);
const isBig = (p: PO) => p.total > PO_LIMIT;

/** tombol tanggal: teks berformat "01 Okt 2026", input date asli transparan di atasnya */
function DateBtn({
  v,
  empty,
  label,
  onChange,
}: {
  v: string;
  empty: string;
  label: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="ap-date">
      <span>{ymdLabel(v, empty)}</span>
      <input
        type="date"
        value={v}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            (
              e.currentTarget as HTMLInputElement & { showPicker?: () => void }
            ).showPicker?.();
          } catch {
            /* abaikan */
          }
        }}
      />
    </label>
  );
}

/** menu tombol "···" pada baris tabel; dirender lewat portal agar tidak terpotong tabel */
function RowMenu({
  items,
}: {
  items: { l: string; f: () => void; cls?: string }[];
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  if (!items.length) return null;
  return (
    <>
      <button
        type="button"
        className="ap-dots"
        aria-label="Aksi lainnya"
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={(e) => {
          if (pos) return setPos(null);
          const r = e.currentTarget.getBoundingClientRect();
          const h = items.length * 36 + 14;
          setPos({
            x: Math.max(8, r.right - 172),
            y:
              r.bottom + h + 12 > window.innerHeight
                ? Math.max(8, r.top - h - 6)
                : r.bottom + 6,
          });
        }}
      >
        ···
      </button>
      {pos &&
        createPortal(
          <>
            <div className="ap-mask" onClick={() => setPos(null)} />
            <div
              className="ap-menu"
              role="menu"
              style={{ left: pos.x, top: pos.y }}
            >
              {items.map((it) => (
                <button
                  key={it.l}
                  type="button"
                  role="menuitem"
                  className={it.cls}
                  onClick={() => {
                    setPos(null);
                    it.f();
                  }}
                >
                  {it.l}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}

function AllPage({
  list,
  bps,
  depts,
  init,
  onPrint,
  onCopy,
  onDone,
  onReject,
  onPoReject,
  onReopen,
  lockedOf,
  onExport,
  onViewForm,
}: {
  list: PO[];
  bps: BP[];
  depts: string[];
  init: { dept: string; stat: string; q: string };
  onPrint: (no: string) => void;
  onCopy: (p: PO, all: boolean) => void;
  onDone: (no: string) => void;
  onReject: (no: string) => void;
  onPoReject: (no: string) => void;
  onReopen: (no: string) => void;
  lockedOf: (p: PO) => boolean;
  onExport: (l: PO[]) => void;
  onViewForm?: (p: PO) => void; // admin: buka form isian PO (mode lihat saja)
  onAllowReprint?: (no: string) => void;
}) {
  const fromLink = !!(init.dept || init.stat || init.q); // dibuka dari tautan "Lihat Semua"/pencarian: tampilkan semua periode
  const def = monthRange();
  const f0 = {
    from: fromLink ? '' : def.from,
    to: fromLink ? '' : def.to,
    dept: init.dept,
    by: '',
    stat: init.stat,
  };
  const [dr, setDr] = useState(f0); // isian filter (belum diterapkan)
  const [ap, setAp] = useState(f0); // filter yang sedang berlaku
  const [q, setQ] = useState(init.q);
  const [open, setOpen] = useState('');
  const [lim, setLim] = useState<'' | 'atas' | 'bawah'>(''); // filter laporan nilai PO
  const [sort, setSort] = useState<'' | 'asc' | 'desc'>('');
  useEffect(() => {
    setQ(init.q);
  }, [init.q]);

  const kw = q.trim().toLowerCase();
  const hit = (p: PO) =>
    !kw ||
    (
      p.no +
      ' ' +
      p.v.nama +
      ' ' +
      p.by +
      ' ' +
      p.items.map((i) => i.d).join(' ')
    )
      .toLowerCase()
      .includes(kw);
  const pass = (p: PO, f: typeof ap) =>
    (!f.dept || p.dept === f.dept) &&
    (!f.by || p.by === f.by) &&
    (!f.stat || poState(p) === f.stat);
  const inR = (p: PO, from: string, to: string) => {
    const k = ymd(new Date(p.iso));
    return (!from || k >= from) && (!to || k <= to);
  };

  const useRange = !kw; // pencarian kata kunci mencari di semua periode
  const cur = list.filter(
    (p) => pass(p, ap) && hit(p) && (!useRange || inR(p, ap.from, ap.to))
  );
  let prv: PO[] | null = null;
  if (useRange && ap.from && ap.to) {
    const t0 = new Date(ap.from + 'T00:00:00').getTime();
    const len =
      Math.round((new Date(ap.to + 'T00:00:00').getTime() - t0) / 86400000) + 1;
    const pf = ymd(new Date(t0 - len * 86400000)),
      pt = ymd(new Date(t0 - 86400000));
    prv = list.filter((p) => pass(p, ap) && inR(p, pf, pt));
  }
  const delta = (a: number, b: number | null) => {
    if (b === null) return null;
    if (!b)
      return a ? { t: 'Baru', tone: 'good' } : { t: '→ 0%', tone: 'flat' };
    const pc = Math.round(((a - b) / b) * 100);
    return pc > 0
      ? { t: `↑ +${pc}%`, tone: 'good' }
      : pc < 0
      ? { t: `↓ -${Math.abs(pc)}%`, tone: 'bad' }
      : { t: '→ 0%', tone: 'flat' };
  };

  const total = cur.reduce((x, p) => x + nomOf(p), 0);
  const nWait = cur.filter(isWait).length;
  const kpis: {
    l: string;
    ic: ReactNode;
    v: string;
    badge?: [string, string];
    d?: { t: string; tone: string } | null;
    sub: string;
    dIn?: 'val' | 'sub';
  }[] = [
    {
      l: 'Total Pengajuan PO',
      ic: <Ic n="fileList" s={22} />,
      v: String(cur.length),
      d: delta(cur.length, prv ? prv.length : null),
      dIn: 'val',
      sub: 'vs periode sebelumnya',
    },
    {
      l: 'Jumlah Pembuat PO',
      ic: <Ic n="users" s={22} />,
      v: String(new Set(cur.map((p) => p.uid)).size),
      badge: ['Aktif', 'b'],
      sub: '',
    },
    {
      l: 'Departemen',
      ic: <Ic n="building" s={22} />,
      v: String(new Set(cur.map((p) => p.dept)).size),
      badge: ['Terlibat', 'b'],
      sub: '',
    },
    {
      l: 'Total Nilai PO',
      ic: <span className="rpc">Rp</span>,
      v: rp(total),
      d: delta(total, prv ? prv.reduce((x, p) => x + nomOf(p), 0) : null),
      dIn: 'sub',
      sub: 'vs periode sebelumnya',
    },
    {
      l: 'Menunggu Approval',
      ic: <Ic n="hourglass" s={22} />,
      v: String(nWait),
      badge: ['Open', 'y'],
      sub: `dari ${cur.length} pengajuan`,
    },
  ];

  // grafik: jumlah pembuat PO (unik) per departemen
  const dm = new Map<string, Set<string>>();
  cur.forEach((p) => {
    if (!dm.has(p.dept)) dm.set(p.dept, new Set());
    dm.get(p.dept)!.add(p.uid);
  });
  const chart = [...dm]
    .map(([d, s]) => ({ d, n: s.size }))
    .sort((x, y) => y.n - x.n || x.d.localeCompare(y.d, 'id'));
  const mx = chart[0]?.n ?? 0;
  const top = mx <= 4 ? 4 : Math.ceil(mx / 4) * 4;
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const shade = (i: number) => {
    const k = chart.length > 1 ? i / (chart.length - 1) : 0;
    const m = (a: number, b: number) => Math.round(a + (b - a) * k * 0.8);
    return `linear-gradient(180deg,rgb(${m(59, 147)},${m(130, 197)},${m(
      246,
      253
    )}),rgb(${m(29, 120)},${m(78, 175)},${m(216, 250)}))`;
  };

  // top 5 pembuat PO
  const um = new Map<string, { nama: string; dept: string; n: number }>();
  cur.forEach((p) => {
    const x = um.get(p.uid);
    um.set(p.uid, { nama: p.by, dept: p.dept, n: (x?.n ?? 0) + 1 });
  });
  const tops = [...um.values()]
    .sort((x, y) => y.n - x.n || x.nama.localeCompare(y.nama, 'id'))
    .slice(0, 5);
  const tmax = tops[0]?.n || 1;

  const big = cur.filter(isBig);
  const small = cur.filter((p) => !isBig(p));
  const sumOf = (l: PO[]) => l.reduce((x, p) => x + nomOf(p), 0);
  const rows = cur
    .filter((p) => !lim || (lim === 'atas' ? isBig(p) : !isBig(p)))
    .sort((a, b) =>
    sort
      ? (sort === 'asc' ? 1 : -1) * a.by.localeCompare(b.by, 'id') ||
        b.iso.localeCompare(a.iso)
      : b.iso.localeCompare(a.iso)
  );
  const pg = usePager(rows, 15);
  const makers = [...new Set(list.map((p) => p.by))].sort((a, b) =>
    a.localeCompare(b, 'id')
  );
  const none = <div className="empty">Belum ada data pada filter ini.</div>;
  const reset = () => {
    const z = { from: def.from, to: def.to, dept: '', by: '', stat: '' };
    setDr(z);
    setAp(z);
    setQ('');
    setOpen('');
    setLim('');
  };

  return (
    <div className="dash ap">
      <div className="card ap-filter">
        <div className="apf">
          <div className="apf-f">
            <label>Periode</label>
            <div className="ap-range">
              <Ic n="calendar" s={16} />
              <DateBtn
                v={dr.from}
                empty="Awal"
                label="Tanggal mulai"
                onChange={(v) => setDr((x) => ({ ...x, from: v }))}
              />
              <span>–</span>
              <DateBtn
                v={dr.to}
                empty="Akhir"
                label="Tanggal akhir"
                onChange={(v) => setDr((x) => ({ ...x, to: v }))}
              />
              <Ic n="calendar" s={16} />
            </div>
          </div>
          <div className="apf-f">
            <label>Departemen</label>
            <select
              value={dr.dept}
              onChange={(e) => setDr((x) => ({ ...x, dept: e.target.value }))}
            >
              <option value="">Semua departemen</option>
              {depts.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="apf-f">
            <label>Pembuat PO</label>
            <select
              value={dr.by}
              onChange={(e) => setDr((x) => ({ ...x, by: e.target.value }))}
            >
              <option value="">Semua nama</option>
              {makers.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="apf-f">
            <label>Status</label>
            <select
              value={dr.stat}
              onChange={(e) => setDr((x) => ({ ...x, stat: e.target.value }))}
            >
              <option value="">Semua status</option>
              {[...STATUSES, 'Rejected'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="apf-btns">
            <button
              type="button"
              className="pri"
              onClick={() => {
                setAp(dr);
                setOpen('');
              }}
            >
              <Ic n="filter" s={15} />
              Terapkan Filter
            </button>
            <button type="button" className="ap-reset" onClick={reset}>
              <Ic n="reset" s={15} />
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="kpis ap-kpis">
        {kpis.map((k) => (
          <div className="card kpi ap-kpi" key={k.l}>
            <span className="ap-kic">{k.ic}</span>
            <div className="ap-kb">
              <FitBox>
                <small>{k.l}</small>
              </FitBox>
              <FitBox>
                <div className="ap-kv">
                  <b>{k.v}</b>
                  {k.badge && (
                    <em className={'ap-bdg ' + k.badge[1]}>{k.badge[0]}</em>
                  )}
                  {k.d && k.dIn === 'val' && (
                    <em className={'ap-dl ' + k.d.tone}>{k.d.t}</em>
                  )}
                </div>
              </FitBox>
              {(k.sub || (k.d && k.dIn === 'sub')) && (
                <FitBox>
                  <span className="ap-ks">
                    {k.d && k.dIn === 'sub' && (
                      <em className={'ap-dl ' + k.d.tone}>{k.d.t}</em>
                    )}
                    {k.d && k.dIn === 'sub' && ' '}
                    {k.sub}
                  </span>
                </FitBox>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="drow ap-row">
        <DCard ic="chart" title="Jumlah Pembuat PO per Departemen">
          {!chart.length ? (
            none
          ) : (
            <div className="ap-chart">
              <span className="ap-yt">Jumlah Pembuat PO</span>
              <div className="ap-plot">
                <div className="ap-yax">
                  {[...ticks].reverse().map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="ap-area">
                  {ticks.map((t) => (
                    <i
                      className="ap-grid"
                      key={t}
                      style={{ bottom: `${(t / top) * 100}%` }}
                    />
                  ))}
                  <div className="ap-bars">
                    {chart.map((r, i) => (
                      <div
                        className="ap-col"
                        key={r.d}
                        title={`${r.d}: ${r.n} pembuat PO`}
                      >
                        <i
                          style={{
                            height: `${(r.n / top) * 100}%`,
                            background: shade(i),
                            animationDelay: `${i * 60}ms`,
                          }}
                        >
                          <b>{r.n}</b>
                        </i>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ap-xl">
                {chart.map((r) => (
                  <span key={r.d} title={r.d}>
                    {r.d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </DCard>
        <DCard ic="users" title="Top 5 Pembuat PO">
          {!tops.length ? (
            none
          ) : (
            <div className="ap-top">
              <div className="ap-th">
                <span>Nama</span>
                <span>Jumlah Pengajuan</span>
              </div>
              {tops.map((t, i) => (
                <div className="ap-tr" key={t.nama + i}>
                  <span className="nm" title={`${t.nama} (${t.dept})`}>
                    {t.nama} ({t.dept})
                  </span>
                  <span className="bt">
                    <i
                      style={{
                        width: `${Math.max(6, (t.n / tmax) * 100)}%`,
                        animationDelay: `${i * 80}ms`,
                      }}
                    />
                  </span>
                  <span className="ct">{t.n}</span>
                </div>
              ))}
            </div>
          )}
        </DCard>
      </div>

      <div className="ap-lim">
        {(
          [
            ['atas', 'PO di Atas Rp 10 Juta', big, 'Wajib approve Managing Director'],
            ['bawah', 'PO di Bawah Rp 10 Juta', small, 'Tanpa approval Managing Director'],
          ] as const
        ).map(([k, t, l, sub]) => (
          <button
            type="button"
            key={k}
            className={'card ap-limc ' + k + (lim === k ? ' on' : '')}
            title="Klik untuk menyaring tabel; klik lagi untuk menampilkan semua"
            onClick={() => setLim(lim === k ? '' : k)}
          >
            <small>{t}</small>
            <div className="ap-limv">
              <b>{l.length}</b>
              <span>PO</span>
              <em>{rp(sumOf(l))}</em>
            </div>
            <span
              className="ap-lims"
              style={k === 'atas' && !l.length ? { color: '#6b7280' } : undefined}
            >
              {k === 'atas' && !l.length
                ? 'Tidak ada PO di atas Rp 10 juta (tidak perlu approve Managing Director)'
                : sub}
            </span>
          </button>
        ))}
      </div>

      <DCard
        ic="fileList"
        title="Daftar Pengajuan PO"
        right={
          <button
            type="button"
            className="ap-exp"
            onClick={() => onExport(rows)}
          >
            <Ic n="download" s={15} />
            Ekspor CSV
          </button>
        }
      >
        {kw && (
          <div className="info">
            <span>
              Hasil pencarian: <b>{q}</b> (semua periode)
            </span>
            <button type="button" className="ghost" onClick={() => setQ('')}>
              Hapus pencarian
            </button>
          </div>
        )}
        {!rows.length ? (
          none
        ) : (
          <div className="tbl">
            <table className="ap-tbl">
              <thead>
                <tr>
                  <th>No. Pengajuan</th>
                  <th>Tanggal Submit</th>
                  <th>Departemen</th>
                  <th>
                    <button
                      type="button"
                      className="ap-sort"
                      title="Urutkan nama"
                      onClick={() =>
                        setSort(
                          sort === '' ? 'asc' : sort === 'asc' ? 'desc' : ''
                        )
                      }
                    >
                      Pembuat PO{' '}
                      <span className="ap-sa">
                        {sort === 'asc' ? '↑' : sort === 'desc' ? '↓' : '⇅'}
                      </span>
                    </button>
                  </th>
                  <th>Vendor</th>
                  <th>Kategori</th>
                  <th>Pemohon</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {pg.view.map((p) => {
                  const st = poState(p),
                    lk = lockedOf(p);
                  const { bp, bi } = bpOfPo(bps, p);
                  const items: { l: string; f: () => void; cls?: string }[] = [
                    { l: 'Cetak PO', f: () => onPrint(p.no) },
                    { l: 'Salin Vendor', f: () => onCopy(p, false) },
                    { l: 'Salin Semua', f: () => onCopy(p, true) },
                  ];
                  if (onViewForm)
                    items.push({ l: 'Lihat Form', f: () => onViewForm(p) });
                  if (!lk && st === 'Open') {
                    items.push({ l: 'Tandai Done', f: () => onDone(p.no) });
                    items.push({
                      l: 'Cancel Pengajuan',
                      f: () => onReject(p.no),
                      cls: 'cx',
                    });
                  }
                  if (!lk && st !== 'Open' && !p.rejFinal)
                    items.push({ l: 'Buka Lagi', f: () => onReopen(p.no) });
                  if (!lk && !p.rejFinal)
                    items.push({
                      l: 'PO Reject',
                      f: () => onPoReject(p.no),
                      cls: 'cx',
                    });
                  return (
                    <Fragment key={p.no}>
                      <tr>
                        <td>
                          <button
                            type="button"
                            className="lnk"
                            title="Lihat & cetak dokumen PO"
                            onClick={() => onPrint(p.no)}
                          >
                            {p.no}
                          </button>
                          {lk && (
                            <span
                              className="tag s-wait"
                              style={{ marginLeft: 6 }}
                              title="Periode tahun ini terkunci"
                            >
                              🔒
                            </span>
                          )}
                        </td>
                        <td>{fmtDT(p.iso)}</td>
                        <td className="dp">{p.dept}</td>
                        <td>{p.by}</td>
                        <td className="vd">
                          {p.v.nama}
                          <div
                            className={
                              'ap-bp ' +
                              (!bi
                                ? 'na'
                                : bi.expired
                                ? 'ex'
                                : bi.soon
                                ? 'so'
                                : 'ak')
                            }
                            title={
                              bp
                                ? `${bp.kode} · ${bp.nama}`
                                : 'Vendor ini belum ada di menu Data Supplier'
                            }
                          >
                            <i />
                            {!bp || !bi
                              ? 'Belum terdaftar di Supplier BP'
                              : bi.expired
                              ? `BP Expired · ${ymdLabel(bp.exp, '')}`
                              : bi.soon
                              ? `BP Segera Exp · ${ymdLabel(bp.exp, '')} (${
                                  bi.days
                                } hari lagi)`
                              : `BP Aktif · s/d ${ymdLabel(bp.exp, '')}`}
                          </div>
                        </td>
                        <td>{p.items[0]?.k || 'Tanpa kategori'}</td>
                        <td>{p.by}</td>
                        <td className="tt">
                          {rp(p.total)}
                          <div
                            className={'ap-nl ' + (isBig(p) ? 'big' : 'sm')}
                            title={
                              isBig(p)
                                ? 'Nilai PO di atas Rp 10 juta: wajib ada approve Managing Director'
                                : 'Nilai PO di bawah Rp 10 juta'
                            }
                          >
                            {isBig(p) ? '> Rp 10 jt' : '≤ Rp 10 jt'}
                          </div>
                          {isBig(p) && (
                            <div className="ap-nl-n">
                              Noted: wajib approve Managing Director
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={
                              'tag ' +
                              (st === 'Rejected' ? 's-rejected' : 's-' + st)
                            }
                          >
                            {st}
                          </span>
                          {st === 'Rejected' && p.rej && (
                            <div className="note bad">
                              {p.rejFinal ? 'PO Reject' : 'Ditolak'}{' '}
                              {fmtDT(p.rej)}
                              {p.rejWhy && (
                                <>
                                  <br />
                                  {p.rejFinal ? 'Keterangan reject' : 'Alasan'}:{' '}
                                  {p.rejWhy}
                                </>
                              )}
                              {p.rejFinal && (
                                <>
                                  <br />
                                  <b>
                                    {p.newNo
                                      ? `Diganti PO baru: ${p.newNo}`
                                      : 'Menunggu user membuat PO baru'}
                                  </b>
                                </>
                              )}
                            </div>
                          )}
                          {p.prevNo && (
                            <div className="note">
                              Pengganti PO reject {p.prevNo}
                            </div>
                          )}
                          {st === 'Open' && p.resent && (
                            <div className="note">
                              Dikirim ulang {fmtDT(p.resent)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="ap-act">
                            <button
                              type="button"
                              className="ap-det"
                              aria-expanded={open === p.no}
                              onClick={() => setOpen(open === p.no ? '' : p.no)}
                            >
                              Detail
                            </button>
                            <RowMenu items={items} />
                          </div>
                        </td>
                      </tr>
                      {open === p.no && (
                        <tr>
                          <td colSpan={10} className="detail">
                            <div>
                              <b>{p.v.nama}</b> · PIC {p.v.pic} · {p.v.telp}
                              {p.v.fax && ` · Fax ${p.v.fax}`} · {p.v.email}
                              <br />
                              {p.v.alamat} · NPWP {p.v.npwp}
                            </div>
                            {p.pay && (
                              <div>
                                Pembayaran: {p.pay.bank} · {p.pay.cabang} · No.
                                Rek {p.pay.rek} a.n. {p.pay.an}
                              </div>
                            )}
                            <ul>
                              {p.items.map((l, n) => (
                                <li key={n}>
                                  {l.d} — {l.q} {l.s} × {rp(l.p)} ={' '}
                                  {rp(l.q * l.p)}
                                </li>
                              ))}
                            </ul>
                            <div>
                              Subtotal {rp(p.sub)} · Discount {rp(p.disc)} ·
                              Pajak {taxName(p.rate)}
                              {p.ong ? ` · Ongkir ${rp(p.ong)}` : ''} ·{' '}
                              <b>Grand Total {rp(p.total)}</b>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <Pager page={pg.page} pages={pg.pages} onPage={pg.setPage} />
          </div>
        )}
      </DCard>
    </div>
  );
}

/* ================= APLIKASI UTAMA ================= */
type Nav = { k: string; l: string; ic: string; bd?: number };
const META: Record<string, { ic: string; t: string; s: string; c: string }> = {
  dash: {
    ic: 'home',
    t: 'Dashboard',
    s: 'Ringkasan pengajuan Purchase Order.',
    c: 'Dashboard',
  },
  form: {
    ic: 'filePlus',
    t: 'Form PO Request',
    s: 'Lengkapi informasi berikut untuk membuat permintaan Purchase Order (PO).',
    c: 'Buat PO Request',
  },
  riwayat: {
    ic: 'fileList',
    t: 'Riwayat Pengajuan',
    s: 'Gunakan tombol Salin jika vendornya sama, lalu sesuaikan isiannya.',
    c: 'Riwayat Pengajuan',
  },
  approval: {
    ic: 'clock',
    t: 'Menunggu Approval',
    s: 'Pengajuan yang belum diproses menjadi PO.',
    c: 'Menunggu Approval',
  },
  tracking: {
    ic: 'truck',
    t: 'Tracking PO',
    s: 'Pantau tahapan PO dari dibuat sampai proses pembayaran.',
    c: 'Tracking PO',
  },
  supplier: {
    ic: 'users',
    t: 'Data Supplier',
    s: 'Master Supplier (unggah Excel/PDF oleh admin, dipakai semua user) dan Supplier BP (status aktif & tanggal expired).',
    c: 'Data Supplier',
  },
  history: {
    ic: 'clock',
    t: 'Change History',
    s: 'Riwayat perubahan data PO per akun: siapa, kapan, bagian, dan apa yang diubah.',
    c: 'Change History',
  },
  notif: {
    ic: 'bell',
    t: 'Notifikasi',
    s: 'Pemberitahuan status pengajuan Anda.',
    c: 'Notifikasi',
  },
  kategori: {
    ic: 'tag',
    t: 'Master Kategori PO',
    s: 'Pengelompokan kebutuhan barang dan jasa untuk pengajuan Purchase Order.',
    c: 'Master Kategori PO',
  },
  barang: {
    ic: 'box',
    t: 'Daftar Barang',
    s: 'Barang dan jasa yang pernah dipesan.',
    c: 'Daftar Barang',
  },
  setting: {
    ic: 'gear',
    t: 'Pengaturan',
    s: 'Profil, password, departemen, penomoran PO, dan tampilan aplikasi.',
    c: 'Pengaturan',
  },
  all: {
    ic: 'fileList',
    t: 'Semua Pengajuan',
    s: 'Seluruh pengajuan PO dari semua departemen.',
    c: 'Semua Pengajuan',
  },
  doc: {
    ic: 'file',
    t: 'Dokumen PO',
    s: 'Lihat dan cetak dokumen Purchase Order.',
    c: 'Dokumen PO',
  },
  users: {
    ic: 'users',
    t: 'Verifikasi User',
    s: 'Setujui atau tolak pendaftaran akun.',
    c: 'Verifikasi User',
  },
};
/** Kategori dikelola admin: tipe Barang/Jasa untuk filter dashboard; desc/ex = panduan bagi user; off = nonaktif (tidak bisa dipilih lagi, riwayat tetap utuh). */
type CatType = 'Barang' | 'Jasa';
type Cat = {
  name: string;
  type: CatType;
  desc?: string;
  ex?: string;
  off?: boolean;
};
const guessType = (n: string): CatType =>
  n.trim().toLowerCase() === 'jasa' ? 'Jasa' : 'Barang';
const normCats = (l: (Cat | string)[]): Cat[] =>
  l.map((c) => (typeof c === 'string' ? { name: c, type: guessType(c) } : c));
const CAT_SEED: [string, CatType, string, string][] = [
  [
    'Alat Pelindung Diri (APD)',
    'Barang',
    'Perlengkapan keselamatan kerja',
    'Safety shoes, helm, sarung tangan, masker',
  ],
  [
    'Fire & Safety Equipment',
    'Barang',
    'Peralatan pemadam kebakaran dan keamanan',
    'APAR, hydrant, fire alarm, safety sign',
  ],
  [
    'Peralatan & Spare Part Mesin',
    'Barang',
    'Komponen dan spare part mesin produksi',
    'Bearing, motor, sensor, belt, gearbox',
  ],
  [
    'Peralatan Produksi',
    'Barang',
    'Peralatan kerja dan penunjang produksi',
    'Tools, jig, fixture, peralatan kerja',
  ],
  [
    'Material Produksi',
    'Barang',
    'Bahan baku dan material pendukung produksi',
    'Bahan baku, chemical, material pendukung',
  ],
  [
    'Maintenance & Engineering Supplies',
    'Barang',
    'Perlengkapan teknik dan maintenance',
    'Kabel, lampu, pipa, valve, komponen listrik',
  ],
  [
    'ATK & Perlengkapan Kantor',
    'Barang',
    'Alat tulis dan perlengkapan kantor',
    'Kertas, tinta, alat tulis, stationery',
  ],
  [
    'Furniture & Office Equipment',
    'Barang',
    'Perabot dan peralatan kantor',
    'Meja, kursi, lemari, mesin kantor',
  ],
  [
    'IT Hardware & Software',
    'Barang',
    'Perangkat IT dan lisensi software',
    'Laptop, printer, perangkat jaringan, lisensi software',
  ],
  [
    'General Affairs & Facility Supplies',
    'Barang',
    'Perlengkapan umum dan fasilitas kantor/pabrik',
    'Perlengkapan kebersihan, sanitary, fasilitas umum',
  ],
  [
    'Perbaikan & Maintenance Mesin',
    'Jasa',
    'Jasa perbaikan dan perawatan mesin',
    'Perbaikan mesin, overhaul, preventive maintenance',
  ],
  [
    'Perbaikan Gedung & Fasilitas',
    'Jasa',
    'Jasa perbaikan gedung dan fasilitas',
    'Perbaikan AC, atap, plumbing, instalasi listrik',
  ],
  [
    'Perizinan & Legalitas',
    'Jasa',
    'Pengurusan perizinan dan legalitas',
    'Pengurusan izin, sertifikasi, perpanjangan izin',
  ],
  [
    'Inspeksi, Kalibrasi & Sertifikasi',
    'Jasa',
    'Jasa inspeksi, kalibrasi dan sertifikasi',
    'Kalibrasi alat ukur, riksa uji, inspeksi K3',
  ],
  [
    'Jasa Fire & Safety',
    'Jasa',
    'Jasa perawatan dan inspeksi peralatan safety',
    'Refill APAR, servis hydrant, inspeksi fire alarm',
  ],
  [
    'Training & Development',
    'Jasa',
    'Pelatihan dan pengembangan karyawan',
    'Pelatihan karyawan, sertifikasi kompetensi',
  ],
  [
    'Konsultan & Professional Services',
    'Jasa',
    'Jasa konsultasi dan profesional',
    'Konsultan ISO/IATF, audit eksternal, jasa hukum',
  ],
  [
    'IT Services & Maintenance',
    'Jasa',
    'Jasa perbaikan dan pemeliharaan IT',
    'Perbaikan komputer, maintenance server, dukungan IT',
  ],
  [
    'Transportasi & Logistik',
    'Jasa',
    'Jasa transportasi dan pengiriman',
    'Pengiriman barang, ekspedisi, sewa kendaraan',
  ],
  [
    'Outsourcing & General Services',
    'Jasa',
    'Jasa tenaga kerja dan layanan umum',
    'Cleaning service, security, pest control',
  ],
  [
    'Event & Employee Engagement',
    'Jasa',
    'Kegiatan dan acara karyawan',
    'Family gathering, penyelenggara acara, kegiatan karyawan',
  ],
];
const DEF_CATS: Cat[] = CAT_SEED.map(([name, type, desc, ex]) => ({
  name,
  type,
  desc,
  ex,
}));
const CAT_VER = '3';
/** Migrasi sekali: lengkapi daftar dengan 21 kategori baku. Kategori lama (ATK, Perlengkapan Kantor, Jasa) dinonaktifkan, bukan dihapus, agar riwayat PO tetap utuh. */
const mergeCats = (raw: (Cat | string)[]): Cat[] => {
  const cur = normCats(raw);
  const LEGACY = ['atk', 'perlengkapan kantor', 'jasa'];
  const out = cur.map((c) => {
    const d = DEF_CATS.find(
      (x) => x.name.toLowerCase() === c.name.toLowerCase()
    );
    if (d) return { ...c, desc: c.desc ?? d.desc, ex: c.ex ?? d.ex };
    return LEGACY.includes(c.name.toLowerCase()) ? { ...c, off: true } : c;
  });
  DEF_CATS.forEach((d) => {
    if (!out.some((c) => c.name.toLowerCase() === d.name.toLowerCase()))
      out.push({ ...d });
  });
  return out;
};
const catMatch = (c: Cat, q: string) =>
  !q.trim() ||
  [c.name, c.type, c.desc ?? '', c.ex ?? ''].some((t) =>
    t.toLowerCase().includes(q.trim().toLowerCase())
  );

/* ================= DATA DUMMY 6 BULAN (dimuat otomatis sekali saat pertama dijalankan) ================= */
/** Data contoh (akun demo + PO dummy). Untuk produksi HARUS false: akun demo memakai password yang sudah umum diketahui. */
const SEED_DEMO = false;
const DEMO_USERS: User[] = [
  {
    id: 'demo-acc',
    nama: 'Maya Anggraini',
    email: 'maya.anggraini@argapura.com',
    pass: 'demo123',
    dept: 'Accounting',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-abd',
    nama: 'Rizky Firmansyah',
    email: 'rizky.firmansyah@argapura.com',
    pass: 'demo123',
    dept: 'Automotive Business Development',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-bd',
    nama: 'Andreas Wibowo',
    email: 'andreas.wibowo@argapura.com',
    pass: 'demo123',
    dept: 'Business Development',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-enp',
    nama: 'Bagus Setiawan',
    email: 'bagus.setiawan@argapura.com',
    pass: 'demo123',
    dept: 'Engineering & Project',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-fac',
    nama: 'Siti Rahayu',
    email: 'siti.rahayu@argapura.com',
    pass: 'demo123',
    dept: 'Facility & Service',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-fin',
    nama: 'Dewi Lestari',
    email: 'dewi.lestari@argapura.com',
    pass: 'demo123',
    dept: 'Finance',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-gs',
    nama: 'Rina Kartika',
    email: 'rina.kartika@argapura.com',
    pass: 'demo123',
    dept: 'General Sales',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-it',
    nama: 'Fajar Nugroho',
    email: 'fajar.nugroho@argapura.com',
    pass: 'demo123',
    dept: 'IT/Digital Transform',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-ops',
    nama: 'Hendra Kusuma',
    email: 'hendra.kusuma@argapura.com',
    pass: 'demo123',
    dept: 'Operation Support',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-prd',
    nama: 'Agus Prasetyo',
    email: 'agus.prasetyo@argapura.com',
    pass: 'demo123',
    dept: 'Production',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-pur',
    nama: 'Budi Santoso',
    email: 'budi.santoso@argapura.com',
    pass: 'demo123',
    dept: 'Purchasing & Supplier Management',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-qa',
    nama: 'Nur Aini',
    email: 'nur.aini@argapura.com',
    pass: 'demo123',
    dept: 'QA/QC',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-scm',
    nama: 'Dimas Pratama',
    email: 'dimas.pratama@argapura.com',
    pass: 'demo123',
    dept: 'Supply Chain',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-tal',
    nama: 'Putri Handayani',
    email: 'putri.handayani@argapura.com',
    pass: 'demo123',
    dept: 'Talent',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-tec',
    nama: 'Eko Saputro',
    email: 'eko.saputro@argapura.com',
    pass: 'demo123',
    dept: 'Technical',
    role: 'user',
    status: 'approved',
  },
  {
    id: 'demo-new',
    nama: 'Andi Wijaya',
    email: 'andi.wijaya@argapura.com',
    pass: 'demo123',
    dept: 'General Sales',
    role: 'user',
    status: 'pending',
  },
];
const DEMO_VENDORS: { v: Vendor; pay: Pay }[] = [
  {
    v: {
      nama: 'PT Sinar Jaya Abadi',
      alamat:
        'Jl. Industri Raya No. 12, Kawasan Industri Jatake, Tangerang 15136',
      npwp: '01.234.567.8-415.000',
      telp: '021-5901234',
      fax: '021-5901235',
      pic: 'Hendra Gunawan',
      email: 'sales@sinarjaya.co.id',
    },
    pay: {
      rek: '1234567890',
      bank: 'BCA',
      cabang: 'KCP Tangerang',
      an: 'PT Sinar Jaya Abadi',
    },
  },
  {
    v: {
      nama: 'CV Mitra Karya Sejahtera',
      alamat: 'Jl. Raya Bekasi KM 21 No. 45, Cakung, Jakarta Timur 13910',
      npwp: '02.345.678.9-009.000',
      telp: '021-4601122',
      fax: '',
      pic: 'Lestari Wulandari',
      email: 'order@mitrakarya.id',
    },
    pay: {
      rek: '0987654321',
      bank: 'Mandiri',
      cabang: 'Cakung',
      an: 'CV Mitra Karya Sejahtera',
    },
  },
  {
    v: {
      nama: 'PT Global Office Supplies',
      alamat:
        'Gedung Graha Niaga Lt. 3, Jl. Jend. Sudirman Kav. 58, Jakarta Selatan 12190',
      npwp: '03.456.789.0-062.000',
      telp: '021-5250088',
      fax: '021-5250089',
      pic: 'Michael Tanuwijaya',
      email: 'cs@globaloffice.co.id',
    },
    pay: {
      rek: '5560012345',
      bank: 'BNI',
      cabang: 'Sudirman',
      an: 'PT Global Office Supplies',
    },
  },
  {
    v: {
      nama: 'PT Safety Indo Perkasa',
      alamat: 'Jl. Cibitung Industri Blok C-7, Cibitung, Bekasi 17520',
      npwp: '04.567.890.1-435.000',
      telp: '021-8830456',
      fax: '',
      pic: 'Darmawan Putra',
      email: 'penjualan@safetyindo.com',
    },
    pay: {
      rek: '7788990011',
      bank: 'BCA',
      cabang: 'KCU Bekasi',
      an: 'PT Safety Indo Perkasa',
    },
  },
  {
    v: {
      nama: 'CV Berkah Teknik',
      alamat: 'Jl. Kapuk Kamal Raya No. 8, Cengkareng, Jakarta Barat 11720',
      npwp: '05.678.901.2-034.000',
      telp: '021-5410987',
      fax: '',
      pic: 'Yusuf Hidayat',
      email: 'berkahteknik@gmail.com',
    },
    pay: {
      rek: '1400099887766',
      bank: 'Mandiri',
      cabang: 'Cengkareng',
      an: 'CV Berkah Teknik',
    },
  },
  {
    v: {
      nama: 'PT Cahaya Packaging Nusantara',
      alamat: 'Kawasan MM2100 Blok K-3, Cikarang Barat, Bekasi 17530',
      npwp: '06.789.012.3-413.000',
      telp: '021-8981234',
      fax: '021-8981235',
      pic: 'Susanti Wijaya',
      email: 'marketing@cahayapack.co.id',
    },
    pay: {
      rek: '3300445566',
      bank: 'BRI',
      cabang: 'Cikarang',
      an: 'PT Cahaya Packaging Nusantara',
    },
  },
  {
    v: {
      nama: 'UD Maju Bersama',
      alamat: 'Jl. Raya Cileungsi No. 77, Bogor 16820',
      npwp: '07.890.123.4-434.000',
      telp: '021-82490011',
      fax: '',
      pic: 'Slamet Riyadi',
      email: 'majubersama.ud@yahoo.com',
    },
    pay: {
      rek: '6677889900',
      bank: 'BNI',
      cabang: 'Cileungsi',
      an: 'Slamet Riyadi',
    },
  },
  {
    v: {
      nama: 'PT Triputra Logistik',
      alamat: 'Jl. Pluit Selatan Raya No. 21, Penjaringan, Jakarta Utara 14440',
      npwp: '08.901.234.5-071.000',
      telp: '021-6612345',
      fax: '021-6612346',
      pic: 'Aditya Pratama',
      email: 'ops@triputralogistik.co.id',
    },
    pay: {
      rek: '8800112233',
      bank: 'BCA',
      cabang: 'Pluit',
      an: 'PT Triputra Logistik',
    },
  },
];
const DEMO_CATALOG: { k: string; d: string; s: string; p: number }[] = [
  {
    k: 'Alat Pelindung Diri (APD)',
    d: 'Sarung tangan katun',
    s: 'Box',
    p: 85000,
  },
  {
    k: 'Alat Pelindung Diri (APD)',
    d: 'Helm safety proyek',
    s: 'Pcs',
    p: 65000,
  },
  { k: 'Alat Pelindung Diri (APD)', d: 'Masker N95', s: 'Box', p: 195000 },
  { k: 'Alat Pelindung Diri (APD)', d: 'Sepatu safety', s: 'Pcs', p: 285000 },
  { k: 'Alat Pelindung Diri (APD)', d: 'Kacamata safety', s: 'Pcs', p: 35000 },
  { k: 'Alat Pelindung Diri (APD)', d: 'Earplug busa', s: 'Box', p: 75000 },
  { k: 'ATK', d: 'Kertas HVS A4 80 gr', s: 'Rim', p: 52000 },
  { k: 'ATK', d: 'Bolpoin hitam', s: 'Box', p: 38000 },
  { k: 'ATK', d: 'Spidol whiteboard', s: 'Box', p: 62000 },
  { k: 'ATK', d: 'Map folder plastik', s: 'Box', p: 45000 },
  { k: 'ATK', d: 'Tinta printer original', s: 'Pcs', p: 145000 },
  { k: 'ATK', d: 'Stapler dan isi', s: 'Set', p: 48000 },
  {
    k: 'Perlengkapan Kantor',
    d: 'Kursi kerja ergonomis',
    s: 'Unit',
    p: 850000,
  },
  {
    k: 'Perlengkapan Kantor',
    d: 'Lemari arsip besi 4 pintu',
    s: 'Unit',
    p: 1650000,
  },
  {
    k: 'Perlengkapan Kantor',
    d: 'Dispenser air galon bawah',
    s: 'Unit',
    p: 725000,
  },
  {
    k: 'Perlengkapan Kantor',
    d: 'Papan nama ruangan akrilik',
    s: 'Pcs',
    p: 120000,
  },
  {
    k: 'Perlengkapan Kantor',
    d: 'Tempat sampah stainless',
    s: 'Pcs',
    p: 95000,
  },
  { k: 'Peralatan Produksi', d: 'Bearing 6205', s: 'Pcs', p: 78000 },
  { k: 'Peralatan Produksi', d: 'Oli hidrolik 20 liter', s: 'Pcs', p: 640000 },
  { k: 'Peralatan Produksi', d: 'V-belt tipe B', s: 'Pcs', p: 95000 },
  { k: 'Peralatan Produksi', d: 'Mata bor HSS set', s: 'Set', p: 380000 },
  { k: 'Peralatan Produksi', d: 'Kabel power 3x2.5 mm', s: 'Meter', p: 18500 },
  { k: 'Peralatan Produksi', d: 'Roller conveyor', s: 'Unit', p: 1250000 },
  { k: 'Jasa', d: 'Jasa servis AC', s: 'Jasa', p: 450000 },
  { k: 'Jasa', d: 'Jasa kalibrasi timbangan', s: 'Jasa', p: 1500000 },
  { k: 'Jasa', d: 'Jasa pengiriman barang', s: 'Jasa', p: 850000 },
  { k: 'Jasa', d: 'Jasa maintenance genset', s: 'Jasa', p: 3200000 },
  { k: 'Jasa', d: 'Jasa pest control', s: 'Jasa', p: 2750000 },
];
/** Nama kategori baru untuk data dummy (pool per departemen tetap memakai kategori lama di atas). */
const DEMO_K: Record<string, string> = {
  'Kursi kerja ergonomis': 'Furniture & Office Equipment',
  'Lemari arsip besi 4 pintu': 'Furniture & Office Equipment',
  'Bearing 6205': 'Peralatan & Spare Part Mesin',
  'V-belt tipe B': 'Peralatan & Spare Part Mesin',
  'Oli hidrolik 20 liter': 'Material Produksi',
  'Kabel power 3x2.5 mm': 'Maintenance & Engineering Supplies',
  'Jasa servis AC': 'Perbaikan Gedung & Fasilitas',
  'Jasa kalibrasi timbangan': 'Inspeksi, Kalibrasi & Sertifikasi',
  'Jasa pengiriman barang': 'Transportasi & Logistik',
  'Jasa maintenance genset': 'Perbaikan & Maintenance Mesin',
  'Jasa pest control': 'Outsourcing & General Services',
};
const DEMO_KGRP: Record<string, string> = {
  ATK: 'ATK & Perlengkapan Kantor',
  'Perlengkapan Kantor': 'General Affairs & Facility Supplies',
};
const demoK = (c: { k: string; d: string }) =>
  DEMO_K[c.d] ?? DEMO_KGRP[c.k] ?? c.k;
const DEPT_CATS: Record<string, string[]> = {
  Accounting: ['ATK', 'Perlengkapan Kantor', 'Jasa'],
  'Automotive Business Development': ['ATK', 'Perlengkapan Kantor', 'Jasa'],
  'Business Development': ['ATK', 'Perlengkapan Kantor', 'Jasa'],
  'Engineering & Project': [
    'Peralatan Produksi',
    'Alat Pelindung Diri (APD)',
    'Jasa',
  ],
  'Facility & Service': [
    'Perlengkapan Kantor',
    'Jasa',
    'Alat Pelindung Diri (APD)',
    'ATK',
  ],
  Finance: ['ATK', 'Perlengkapan Kantor', 'Jasa'],
  'General Sales': ['ATK', 'Perlengkapan Kantor', 'Jasa'],
  'IT/Digital Transform': ['Perlengkapan Kantor', 'Jasa', 'ATK'],
  'Operation Support': [
    'Peralatan Produksi',
    'Alat Pelindung Diri (APD)',
    'Jasa',
    'ATK',
  ],
  Production: ['Peralatan Produksi', 'Alat Pelindung Diri (APD)', 'Jasa'],
  'Purchasing & Supplier Management': [
    'ATK',
    'Perlengkapan Kantor',
    'Peralatan Produksi',
    'Jasa',
  ],
  'QA/QC': ['Alat Pelindung Diri (APD)', 'Peralatan Produksi', 'Jasa', 'ATK'],
  'Supply Chain': ['Peralatan Produksi', 'Jasa', 'ATK', 'Perlengkapan Kantor'],
  Talent: ['ATK', 'Perlengkapan Kantor', 'Alat Pelindung Diri (APD)', 'Jasa'],
  Technical: ['Peralatan Produksi', 'Alat Pelindung Diri (APD)', 'Jasa'],
};
const DEMO_NOTES = [
  '',
  '',
  '',
  'Mohon dikirim sebelum akhir minggu.',
  'Barang diambil di gudang pusat.',
  'Sertakan faktur pajak saat penagihan.',
  'Kirim ke pabrik Cikarang.',
];

/** Buat PO contoh untuk 6 bulan terakhir (hasil selalu sama setiap kali dijalankan). seqBase = nomor urut terakhir per tahun yang sudah ada. */
function makeDemoPOs(seqBase: Record<number, number>): PO[] {
  let st = 20261027;
  const rnd = () => {
    st = (st + 0x6d2b79f5) | 0;
    let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const now = new Date();
  const today = ymd(now);
  const users = DEMO_USERS.filter((u) => u.status === 'approved');
  const dates: Date[] = [];
  for (let off = 5; off >= 0; off--) {
    const b = new Date(now.getFullYear(), now.getMonth() - off, 1);
    const maxDay =
      off === 0
        ? now.getDate()
        : new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate();
    const n =
      off === 0 ? 14 + Math.floor(rnd() * 5) : 22 + Math.floor(rnd() * 9);
    for (let i = 0; i < n; i++) {
      let d = new Date(
        b.getFullYear(),
        b.getMonth(),
        1 + Math.floor(rnd() * maxDay),
        8 + Math.floor(rnd() * 9),
        Math.floor(rnd() * 60)
      );
      if (d.getTime() > now.getTime())
        d = new Date(now.getTime() - Math.floor(rnd() * 3 * 3600000));
      dates.push(d);
    }
  }
  dates.sort((x, y) => x.getTime() - y.getTime());
  const seq: Record<number, number> = { ...seqBase };
  const keys: TKey[] = ['appr', 'supp', 'hoSend', 'hoRecv', 'recv', 'pay'];
  const gaps = [
    [1, 3],
    [1, 3],
    [1, 3],
    [2, 4],
    [2, 5],
    [3, 7],
  ];
  return dates.map((d) => {
    const u = pick(users);
    const ven = pick(DEMO_VENDORS);
    const pool = DEMO_CATALOG.filter((c) =>
      (DEPT_CATS[u.dept] ?? []).includes(c.k)
    );
    const cnt = Math.min(pool.length, 1 + Math.floor(rnd() * 4));
    const items: Line[] = [...pool]
      .sort(() => rnd() - 0.5)
      .slice(0, cnt)
      .map((c) => {
        const q =
          c.p < 100000
            ? 5 + Math.floor(rnd() * 56)
            : c.p < 500000
            ? 2 + Math.floor(rnd() * 14)
            : c.p < 2e6
            ? 1 + Math.floor(rnd() * 6)
            : 1 + Math.floor(rnd() * 3);
        return {
          d: c.d,
          q,
          s: c.s,
          p: Math.round((c.p * (0.95 + rnd() * 0.12)) / 500) * 500,
          k: demoK(c),
        };
      });
    const sub = items.reduce((a, l) => a + l.q * l.p, 0);
    const disc =
      rnd() < 0.3 ? Math.round((sub * (0.02 + rnd() * 0.03)) / 1000) * 1000 : 0;
    const rate = rnd() < 0.5 ? 0.11 : 0.12;
    const ong = rnd() < 0.4 ? (5 + Math.floor(rnd() * 26)) * 5000 : 0;
    const y = d.getFullYear();
    seq[y] = (seq[y] ?? 0) + 1;
    const po: PO = {
      no: `${String(seq[y]).padStart(3, '0')}/AGP-PO/${PO_CODE}/${
        ROMAN[d.getMonth()]
      }/${y}`,
      iso: d.toISOString(),
      dept: u.dept,
      uid: u.id,
      by: u.nama,
      v: { ...ven.v },
      pay: { ...ven.pay },
      items,
      sub,
      rate,
      disc,
      ong,
      total: calc(sub, rate, disc, ong).total,
      note: pick(DEMO_NOTES),
      status: 'Open',
    };
    const age = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (age >= 2 && rnd() < 0.07) {
      po.rej = new Date(
        Math.min(
          now.getTime(),
          d.getTime() + (1 + Math.floor(rnd() * 2)) * 86400000
        )
      ).toISOString();
      return po;
    }
    const stop =
      age > 10 && rnd() < 0.05
        ? 0
        : age > 14 && rnd() < 0.22
        ? 1 + Math.floor(rnd() * 5)
        : 6;
    let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const trk: Partial<Record<TKey, string>> = {};
    for (let i = 0; i < stop; i++) {
      cur = new Date(
        cur.getFullYear(),
        cur.getMonth(),
        cur.getDate() +
          gaps[i][0] +
          Math.floor(rnd() * (gaps[i][1] - gaps[i][0] + 1))
      );
      const k = ymd(cur);
      if (k > today) break;
      trk[keys[i]] = k;
    }
    po.trk = trk;
    if (trk.appr) {
      po.status = 'Done';
      const at = new Date(trk.appr + 'T09:00:00');
      po.doneAt = (at.getTime() > now.getTime() ? now : at).toISOString();
    }
    return po;
  });
}

/** PO contoh dengan 44 item (lebih dari 14 baris) untuk menguji tampilan PO dua kolom. Dimuat sekali. */
const REF_ITEMS: [string, number, string, number][] = [
  ['Amplop coklat A4 excecutive', 1, 'Pack', 38000],
  ['Baterai alkaline AA (isi 2)', 6, 'Set', 18000],
  ['Baterai alkaline AAA (isi 2)', 6, 'Set', 18000],
  ['Binder clip 111 joyko', 4, 'Pcs', 6000],
  ['Binder clip 107 joyko', 11, 'Pack', 4000],
  ['Binder clip 155 joyko', 6, 'Pack', 10000],
  ['Binder clip 260 joyko', 2, 'Pack', 20000],
  ['Buku HC paperline folio 100', 3, 'Pcs', 20000],
  ['Kertas CF K-2/2 paperprint', 6, 'Dus', 180000],
  ['Cutter L-500 kenko', 1, 'Pcs', 17000],
  ['Gunting kecil kenko', 3, 'Pcs', 8000],
  ['Isi staples kangaro no 10', 3, 'Box', 40000],
  ['Kertas FC A4 70 gr lk copy', 38, 'Rim', 40000],
  ['Kertas FC F4 75 gr lk copy', 1, 'Rim', 46000],
  ['Kertas FC A3 75 gr sidu', 2, 'Rim', 90000],
  ['Post it mark & note', 1, 'Pad', 12000],
  ['Stiker label tom & jery 121', 3, 'Pad', 7000],
  ['Lem stick 21 gr bantex', 4, 'Pad', 8500],
  ['Clear holder F4 daichi', 1, 'Set', 35000],
  ['Map clear holder A4 daichi', 1, 'Set', 35000],
  ['Map clear holder A4 bantex', 1, 'Set', 22000],
  ['Map clear holder F4 bantex BF', 1, 'Set', 24000],
  ['Ordner bindex 717 hitam', 7, 'Pcs', 27000],
  ['Paper clip no 1 joyko', 1, 'Box', 35000],
  ['Pembolong kertas 30', 1, 'Pcs', 22000],
  ['Refill epson Lq 2180', 1, 'Pcs', 95000],
  ['Laminating A4 toho', 1, 'Pack', 110000],
  ['Laminating A3 toho', 3, 'Pack', 210000],
  ['Ballpoint Q-Gel joyko biru', 2, 'Lusin', 43000],
  ['Ballpoint Q-Gel joyko hitam', 2, 'Lusin', 43000],
  ['Ballpoint standar Ae 7 biru', 1, 'Lusin', 21000],
  ['Ballpoint standar Ae 7 hitam zirqon', 5, 'Lusin', 21000],
  ['Ballpoint joyko Q Gel merah', 1, 'Lusin', 43000],
  ['Pus pin kenko', 1, 'Pack', 6000],
  ['Spidol snowman W/B biru', 3, 'Lusin', 90000],
  ['Spidol snowman W/B hitam', 2, 'Lusin', 90000],
  ['Spidol snowman marker hitam', 9, 'Pcs', 7000],
  ['Stabilo bantex 23 sky blue', 4, 'Pcs', 6000],
  ['Stabilo joyco hijau', 14, 'Pcs', 6000],
  ['Stabilo bantex 19 pink', 4, 'Pcs', 6000],
  ['Ink spidol snowman whiteboard hitam', 5, 'Pcs', 18000],
  ['Stapler max HD 10', 1, 'Pcs', 20000],
  ['Tinta stamp piramida biru', 1, 'Pcs', 12500],
  ['Tip ex kenko kertas', 8, 'Pcs', 8500],
];
const makeRefPO = (taken: Set<string>): PO => {
  const lines: Line[] = REF_ITEMS.map(([d, q, s, p]) => ({
    d,
    q,
    s,
    p,
    k: 'ATK & Perlengkapan Kantor',
  }));
  const sub = lines.reduce((a, l) => a + l.q * l.p, 0);
  return {
    no: uniqueNo('176/AGP-PO/' + PO_CODE + '/X/2026', taken),
    iso: new Date(2026, 9, 28, 10, 0).toISOString(),
    dept: 'Purchasing & Supplier Management',
    uid: 'dummy-ref',
    by: 'Nesa',
    v: {
      nama: 'PT. SURYA JAYA WINATA',
      alamat:
        'Jl. Tarum Barat 3 no 29 Cikarang Baru, Jayamukti,\nCikarang Pusat Kab. Bekasi Jawa Barat',
      npwp: '610937604021000',
      telp: '021 2218 8713',
      fax: '',
      pic: 'Nanik Susilowati',
      email: 'n_anik05@yahoo.com',
    },
    pay: {
      rek: '8730915617',
      bank: 'BCA',
      cabang: 'KCP METRO JABABEKA',
      an: 'PT. SURYA JAYA WINATA',
    },
    items: lines,
    sub,
    rate: 0.11,
    disc: 0,
    ong: 0,
    total: calc(sub, 0.11, 0, 0).total,
    status: 'Open',
  };
};

/* =====================================================================
   SINKRON GOOGLE SHEETS  —  tempel BLOK INI di App.tsx, tepat SEBELUM baris
   "export default function App() {"
   Lalu ikuti langkah 3-4 di PETUNJUK.md (panggil useSheetSync di dalam App).
   ===================================================================== */

const ENV_ = ((import.meta as unknown as { env?: Record<string, string> }).env ?? {});
// URL & token diambil dari file .env (VITE_SHEET_URL, VITE_SHEET_TOKEN). Token tidak lagi punya nilai cadangan di kode.
const SHEET_URL: string =
  ENV_.VITE_SHEET_URL ||
  'https://script.google.com/macros/s/AKfycbwUQI5PJkgXKLFgoxV4jI_GzNHg5zS14RjMbcTH9TMHpPgUR-vbJoCKLcORK0Zxmkk6/exec'; // URL hasil Deploy Apps Script
const SHEET_TOKEN: string = ENV_.VITE_SHEET_TOKEN || ''; // WAJIB diisi lewat .env (VITE_SHEET_TOKEN), sama persis dengan Script property TOKEN di Apps Script. Jangan ditulis di kode.
const SHEET_POLL_MS = 20000; // aplikasi membaca ulang sheet tiap 20 detik

type STable = Record<string, string>[];
type STables = Record<string, STable>;
type SyncData = {
  users: User[];
  depts: Dept[];
  taxes: Tax[];
  cats: Cat[];
  bps: BP[];
  msup: MSup[];
  pos: PO[];
  hist: Hist[];
  numCfg: NumCfg;
  theme: number;
  seen: string[];
  brand: Brand;
};

const sv_ = (x: unknown) => (x === undefined || x === null ? '' : String(x));
/** angka dari sel sheet: menerima 1.500.000 / 1500000 / 1,5 / "Rp 1.500" */
const sn_ = (x: string, d = 0) => {
  let t = String(x ?? '')
    .replace(/rp/i, '')
    .replace(/\s/g, '');
  if (!t) return d;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t))
    t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : d;
};
const sb_ = (x: string) => /^(1|true|ya|y|yes)$/i.test(String(x).trim());
const so_ = (x: string) => (x && x.trim() ? x.trim() : undefined);
/** Logo & background disimpan di sheet "Tampilan" (dipecah per 40.000 karakter karena batas 50.000 per sel) agar sama untuk semua user. */
const BRAND_CHUNK = 40000;
const BRAND_IMG = ['logo', 'bg', 'side'] as const;
const brandHas = (b: Brand) => !!(b.logo || b.bg || b.side);
function brandRows(b: Brand): STable {
  const out: STable = [];
  BRAND_IMG.forEach((k) => {
    const v = b[k] || '';
    for (let i = 0, n = 0; i < v.length; i += BRAND_CHUNK, n++)
      out.push({ kunci: k, urut: String(n), nilai: '~' + v.slice(i, i + BRAND_CHUNK) });
  });
  out.push({ kunci: 'glass', urut: '0', nilai: String(b.glass) });
  out.push({ kunci: 'sideBox', urut: '0', nilai: b.sideBox === false ? 'FALSE' : 'TRUE' });
  return out;
}
function brandFrom(rows: STable | undefined, cur: Brand): Brand {
  if (!rows || !rows.length) return cur; // sheet belum punya data tampilan: pertahankan yang ada
  const out: Brand = { ...BRAND0 };
  BRAND_IMG.forEach((k) => {
    out[k] = rows
      .filter((r) => (r.kunci ?? '').trim() === k)
      .sort((a, b) => Number(a.urut) - Number(b.urut))
      .map((r) => String(r.nilai ?? '').replace(/^~/, ''))
      .join('');
  });
  const gl = rows.find((r) => (r.kunci ?? '').trim() === 'glass');
  out.glass = gl ? Math.min(100, Math.max(0, sn_(gl.nilai, 50))) : 50;
  const sb = rows.find((r) => (r.kunci ?? '').trim() === 'sideBox');
  out.sideBox = sb ? sb_(sb.nilai) : undefined;
  return out;
}
const escH = (x: string) =>
  x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Kirim email lewat Apps Script (MailApp). Mengembalikan true bila terkirim. */
async function sendMail(to: string, subject: string, html: string) {
  try {
    const r = await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: SHEET_TOKEN, mail: { to, subject, html } }),
    });
    const j = await r.json();
    return !!j.ok;
  } catch {
    return false;
  }
}
const mailShell = (title: string, body: string) =>
  `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #d3e2f2;border-radius:12px;overflow:hidden"><div style="background:#0f5fc0;color:#fff;padding:14px 18px;font-weight:700">PO Request System · PT Argapura</div><div style="padding:18px;color:#12284a;font-size:14px;line-height:1.6"><h3 style="margin:0 0 10px">${title}</h3>${body}<p style="margin-top:18px"><a href="${location.origin}" style="background:#0f5fc0;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Buka aplikasi</a></p><p style="color:#5b6f8c;font-size:12px;margin-top:18px">Email otomatis, mohon tidak dibalas.</p></div></div>`;
const mailActivated = (u: User) =>
  mailShell(
    'Akun Anda sudah aktif',
    `<p>Halo <b>${escH(u.nama)}</b>,</p><p>Akun Anda telah diaktifkan oleh admin. Silakan masuk memakai username <b>${escH(uname(u))}</b> dan password yang Anda daftarkan.</p>`
  );
const mailReset = (u: User, tmp: string) =>
  mailShell(
    'Password direset oleh admin',
    `<p>Halo <b>${escH(u.nama)}</b>,</p><p>Password akun Anda direset. Masuk dengan:</p><p>Username: <b>${escH(uname(u))}</b><br/>Password sementara: <b>${escH(tmp)}</b></p><p>Segera ganti password setelah masuk (menu Profil &rarr; Ganti Password).</p>`
  );
const TRK_KEYS: TKey[] = ['appr', 'supp', 'hoSend', 'hoRecv', 'recv', 'pay'];

/** state aplikasi -> baris-baris sheet */
function toTables(d: SyncData): STables {
  const po: STable = [],
    items: STable = [];
  d.pos.forEach((p) => {
    const r: Record<string, string> = {
      no: p.no,
      iso: p.iso,
      dept: p.dept,
      uid: p.uid,
      by: p.by,
      v_nama: p.v.nama,
      v_alamat: p.v.alamat,
      v_npwp: p.v.npwp,
      v_telp: p.v.telp,
      v_fax: p.v.fax,
      v_pic: p.v.pic,
      v_email: p.v.email,
      pay_rek: p.pay?.rek ?? '',
      pay_bank: p.pay?.bank ?? '',
      pay_cabang: p.pay?.cabang ?? '',
      pay_an: p.pay?.an ?? '',
      sub: sv_(p.sub),
      rate: sv_(p.rate),
      disc: sv_(p.disc),
      ong: sv_(p.ong ?? 0),
      total: sv_(p.total),
      status: p.status,
      doneAt: p.doneAt ?? '',
      note: p.note ?? '',
      rej: p.rej ?? '',
      rejWhy: p.rejWhy ?? '',
      rejFinal: p.rejFinal ? '1' : '',
      newNo: p.newNo ?? '',
      prevNo: p.prevNo ?? '',
      resent: p.resent ?? '',
      suppLink: p.suppLink ?? '',
      printN: sv_(p.printN ?? ''),
      printAt: p.printAt ?? '',
      printOk: p.printOk ?? '',
    };
    TRK_KEYS.forEach((k) => {
      r['trk_' + k] = p.trk?.[k] ?? '';
    });
    po.push(r);
    p.items.forEach((l) =>
      items.push({
        no: p.no,
        d: l.d,
        q: sv_(l.q),
        s: l.s,
        p: sv_(l.p),
        k: l.k ?? '',
      })
    );
  });
  return {
    Users: d.users.map((u) => ({
      id: u.id,
      username: u.username ?? '',
      nama: u.nama,
      email: u.email,
      pass: u.pass,
      dept: u.dept,
      role: u.role,
      status: u.status,
    })),
    Departemen: d.depts.map((x) => ({ nama: x.nama })),
    Pajak: d.taxes.map((t) => ({
      id: t.id,
      nama: t.nama,
      persen: String(t.persen),
      tipe: t.tipe,
      aktif: t.aktif ? 'ya' : 'tidak',
    })),
    Kategori: d.cats.map((c) => ({
      name: c.name,
      type: c.type,
      desc: c.desc ?? '',
      ex: c.ex ?? '',
      off: c.off ? 'TRUE' : '',
    })),
    Supplier_BP: d.bps.map((b) => ({
      id: b.id,
      kode: b.kode,
      nama: b.nama,
      exp: toSheetD(b.exp),
    })),
    Master_Supplier: d.msup.map((m) => ({ ...m })),
    PO: po,
    PO_Items: items,
    Change_History: d.hist.map((h) => ({
      id: h.id,
      iso: h.iso,
      uid: h.uid,
      by: h.by,
      dept: h.dept,
      no: h.no,
      what: h.what,
    })),
    Penomoran: Object.keys(d.numCfg)
      .sort()
      .flatMap((y) => [
        {
          tahun: y,
          nomor_awal:
            d.numCfg[y].start === undefined ? '' : String(d.numCfg[y].start),
          terkunci:
            d.numCfg[y].locked === undefined
              ? ''
              : d.numCfg[y].locked
              ? 'TRUE'
              : 'FALSE',
        },
        // nomor PO yang di-Cancel (dilepas): satu baris per nomor, mis. tahun = "2026-free-120"
        ...(d.numCfg[y].free ?? []).map((n) => ({
          tahun: `${y}-free-${n}`,
          nomor_awal: '',
          terkunci: '',
        })),
      ]),
    Pengaturan: [{ kunci: 'tema', nilai: String(d.theme) }],
    Notif_Dibaca: d.seen.map((k) => ({ kunci: k })),
    Tampilan: brandRows(d.brand),
  };
}

/** baris-baris sheet -> state aplikasi (total PO dihitung ulang dari item, jadi mengubah item/harga di sheet ikut menyesuaikan) */
function fromTables(t: STables, cur: SyncData): SyncData {
  const g = (n: string) => t[n] ?? [];
  const users: User[] = g('Users')
    .filter((r) => r.email.trim())
    .map((r) => ({
      id: r.id.trim() || 'u-' + hash32(r.email.toLowerCase()).toString(36),
      username: so_((r.username ?? '').toLowerCase()),
      nama: r.nama,
      email: r.email.trim().toLowerCase(),
      pass: r.pass,
      dept: r.dept,
      role: r.role.trim().toLowerCase() === 'admin' ? 'admin' : 'user',
      status:
        (['pending', 'approved', 'rejected'] as const).find(
          (s) => s === r.status.trim().toLowerCase()
        ) ?? 'pending',
    }));
  const depts: Dept[] = g('Departemen')
    .filter((r) => r.nama.trim())
    .map((r) => ({ nama: r.nama.trim() }));
  const taxes: Tax[] = g('Pajak')
    .filter((r) => (r.nama ?? '').trim() && sn_(r.persen) > 0)
    .map((r, i) => ({
      id: (r.id ?? '').trim() || 'tx-' + i,
      nama: r.nama.trim(),
      persen: sn_(r.persen),
      tipe: (r.tipe ?? '').trim().toLowerCase() === 'kurang' ? 'kurang' : 'tambah',
      aktif: (r.aktif ?? 'ya').trim().toLowerCase() !== 'tidak',
    }));
  const cats: Cat[] = g('Kategori')
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      type: r.type.trim().toLowerCase() === 'jasa' ? 'Jasa' : 'Barang',
      desc: r.desc,
      ex: r.ex,
      off: sb_(r.off) || undefined,
    }));
  const bps: BP[] = g('Supplier_BP')
    .filter((r) => r.nama.trim())
    .map((r) => ({
      id: r.id.trim() || 'bp-' + hash32(r.kode + r.nama).toString(36),
      kode: r.kode,
      nama: r.nama,
      exp: parseExp(r.exp) ?? r.exp,
    }));
  // Master Supplier (diunggah admin). Bila sheet belum punya tabel ini, pertahankan data yang ada di aplikasi.
  const msup: MSup[] = t.Master_Supplier
    ? g('Master_Supplier')
        .filter((r) => msTxt(r.nama))
        .map((r) => {
          const o = {} as MSup;
          MS_KEYS.forEach(({ k }) => (o[k] = msTxt(r[k])));
          o.id = msTxt(r.id) || 'ms-' + hash32(supKey(o.nama)).toString(36);
          return o;
        })
    : cur.msup;
  const byNo = new Map<string, Line[]>();
  g('PO_Items').forEach((r) => {
    if (!r.no.trim()) return;
    const a = byNo.get(r.no.trim()) ?? [];
    a.push({ d: r.d, q: sn_(r.q), s: r.s, p: sn_(r.p), k: r.k });
    byNo.set(r.no.trim(), a);
  });
  const pos: PO[] = g('PO')
    .filter((r) => r.no.trim())
    .map((r) => {
      const items = byNo.get(r.no.trim()) ?? [];
      const sub = items.reduce((a, l) => a + l.q * l.p, 0);
      const rate = sn_(r.rate, 0.11),
        disc = sn_(r.disc),
        ong = sn_(r.ong);
      const trk: Partial<Record<TKey, string>> = {};
      TRK_KEYS.forEach((k) => {
        const x = so_(r['trk_' + k]);
        if (x) trk[k] = x;
      });
      return {
        no: r.no.trim(),
        iso: r.iso,
        dept: r.dept,
        uid: r.uid,
        by: r.by,
        v: {
          nama: r.v_nama,
          alamat: r.v_alamat,
          npwp: r.v_npwp,
          telp: r.v_telp,
          fax: r.v_fax,
          pic: r.v_pic,
          email: r.v_email,
        },
        pay: {
          rek: r.pay_rek,
          bank: r.pay_bank,
          cabang: r.pay_cabang,
          an: r.pay_an,
        },
        items,
        sub,
        rate,
        disc,
        ong,
        total: calc(sub, rate, disc, ong).total,
        status: r.status.trim().toLowerCase() === 'done' ? 'Done' : 'Open',
        doneAt: so_(r.doneAt),
        note: r.note || undefined,
        rej: so_(r.rej),
        rejWhy: so_(r.rejWhy),
        rejFinal: r.rejFinal === '1' || r.rejFinal === 'true' ? true : undefined,
        newNo: so_(r.newNo),
        prevNo: so_(r.prevNo),
        resent: so_(r.resent),
        suppLink: so_(r.suppLink),
        printN: sn_(r.printN, 0) || undefined,
        printAt: so_(r.printAt),
        printOk: so_(r.printOk),
        trk: Object.keys(trk).length ? trk : undefined,
      } as PO;
    });
  const hist: Hist[] = g('Change_History')
    .filter((r) => r.iso.trim())
    .map((r) => ({
      id: r.id.trim() || 'h-' + hash32(r.iso + r.by + r.what).toString(36),
      iso: r.iso,
      uid: r.uid,
      by: r.by,
      dept: r.dept,
      no: r.no,
      what: r.what,
    }));
  const numCfg: NumCfg = {};
  g('Penomoran')
    .filter((r) => /^\d{4}$/.test(r.tahun.trim()))
    .forEach((r) => {
      const st = r.nomor_awal.trim() ? sn_(r.nomor_awal) : undefined;
      const lk = r.terkunci.trim() ? sb_(r.terkunci) : undefined;
      numCfg[r.tahun.trim()] = {
        start: st && st > 0 ? Math.round(st) : undefined,
        locked: lk,
      };
    });
  g('Penomoran').forEach((r) => {
    const f = /^(\d{4})-free-(\d+)$/.exec((r.tahun ?? '').trim());
    if (!f) return;
    const c = numCfg[f[1]] ?? (numCfg[f[1]] = {});
    c.free = [...(c.free ?? []), Number(f[2])];
  });
  const tm = g('Pengaturan').find((r) => r.kunci.trim() === 'tema');
  return {
    users: users.length ? users : cur.users,
    depts: depts.length ? depts : cur.depts,
    taxes: taxes.length ? taxes : cur.taxes,
    cats,
    bps,
    msup,
    pos,
    hist,
    numCfg,
    theme: tm ? sn_(tm.nilai, cur.theme) : cur.theme,
    seen: g('Notif_Dibaca')
      .map((r) => r.kunci)
      .filter(Boolean),
    brand: brandFrom(t.Tampilan, cur.brand),
  };
}

/* ================= PENGGABUNGAN DATA (cegah data hilang saat banyak user menyimpan bersamaan) =================
   Dulu setiap browser mengirim SELURUH data dan menimpa sheet, sehingga user baru yang didaftarkan orang lain
   ikut terhapus (yang terakhir menyimpan "menang"). Sekarang: tiap perubahan digabung per-baris & per-kolom
   (3 arah: data terakhir yang diketahui / data lokal / data terbaru di sheet), lalu dikirim. */
type SRow = Record<string, string>;
const SYNC_KEYS: Record<string, (r: SRow) => string> = {
  Users: (r) => r.id || 'e:' + (r.email ?? '').toLowerCase(),
  Departemen: (r) => (r.nama ?? '').toLowerCase(),
  Pajak: (r) => r.id || (r.nama ?? '') + '|' + (r.persen ?? '') + '|' + (r.tipe ?? ''),
  Kategori: (r) => (r.name ?? '').toLowerCase(),
  Supplier_BP: (r) => r.id || r.kode || '',
  Master_Supplier: (r) => supKey(r.nama ?? '') || r.id || '', // kunci = nama supplier: dua user menambah supplier yang sama bersamaan menyatu, tidak dobel
  PO: (r) => r.no ?? '',
  Change_History: (r) => r.id || (r.iso ?? '') + '|' + (r.by ?? '') + '|' + (r.what ?? ''),
  Penomoran: (r) => r.tahun ?? '',
  Notif_Dibaca: (r) => r.kunci ?? '',
};
const rowSig = (r?: SRow) =>
  r
    ? JSON.stringify(
        Object.keys(r)
          .sort()
          .filter((k) => (r[k] ?? '') !== '')
          .map((k) => [k, r[k]])
      )
    : '';
/** item PO ikut di baris PO-nya agar PO + itemnya digabung sebagai satu kesatuan */
const foldPO = (t: STables): STables => {
  const items = new Map<string, SRow[]>();
  (t.PO_Items ?? []).forEach((r) => {
    const l = items.get(r.no) ?? [];
    l.push(r);
    items.set(r.no, l);
  });
  const o: STables = { ...t };
  delete o.PO_Items;
  o.PO = (t.PO ?? []).map((r) => ({ ...r, __items: JSON.stringify(items.get(r.no) ?? []) }));
  return o;
};
const unfoldPO = (t: STables): STables => {
  const o: STables = { ...t };
  const items: SRow[] = [];
  o.PO = (t.PO ?? []).map((r) => {
    const { __items, ...rest } = r;
    try {
      (JSON.parse(__items || '[]') as SRow[]).forEach((x) => items.push(x));
    } catch {
      /* abaikan */
    }
    return rest;
  });
  o.PO_Items = items;
  return o;
};
function mergeTable(name: string, base: SRow[], local: SRow[], remote: SRow[]): SRow[] {
  const kf = SYNC_KEYS[name];
  if (!kf) return JSON.stringify(local) !== JSON.stringify(base) ? local : remote; // tabel tunggal (tema, tampilan)
  const idx = (t: SRow[]) => {
    const m = new Map<string, SRow>();
    t.forEach((r) => m.set(kf(r), r));
    return m;
  };
  const B = idx(base),
    L = idx(local),
    R = idx(remote);
  const pick = (k: string): SRow | undefined => {
    const b = B.get(k),
      l = L.get(k),
      r = R.get(k);
    if (rowSig(l) === rowSig(b)) return r; // lokal tidak mengubah: ikuti sheet
    if (rowSig(r) === rowSig(b)) return l; // sheet tidak berubah: pakai perubahan lokal
    if (!l) return r; // dihapus lokal tapi diubah orang lain: pertahankan
    if (!r) return l; // dihapus orang lain tapi diubah lokal: pertahankan
    const o: SRow = { ...r }; // sama-sama diubah: gabung per kolom
    new Set([...Object.keys(l), ...Object.keys(b ?? {})]).forEach((c) => {
      if ((l[c] ?? '') !== (b?.[c] ?? '')) o[c] = l[c] ?? '';
    });
    return o;
  };
  const out: SRow[] = [];
  const seen = new Set<string>();
  [remote, local, base].forEach((t) =>
    t.forEach((x) => {
      const k = kf(x);
      if (seen.has(k)) return;
      seen.add(k);
      const v = pick(k);
      if (v) out.push(v);
    })
  );
  return out;
}
/** Dua user mengirim PO bersamaan dan sama-sama mendapat nomor yang sama: PO lokal yang baru diberi nomor berikutnya,
    sehingga PO milik user lain TIDAK tertimpa. Item, riwayat, dan tautan PO pengganti ikut diperbarui. */
function fixPoClash(base: STables, local: STables, remote: STables): STables {
  const inBase = new Set((base.PO ?? []).map((r) => r.no));
  const rMap = new Map((remote.PO ?? []).map((r) => [r.no, r] as const));
  const taken = new Set<string>([...(remote.PO ?? []), ...(local.PO ?? [])].map((r) => r.no));
  const ren = new Map<string, string>();
  (local.PO ?? []).forEach((r) => {
    const x = rMap.get(r.no);
    if (!inBase.has(r.no) && x && (x.iso ?? '') !== (r.iso ?? '')) {
      const nn = uniqueNo(r.no, taken);
      taken.add(nn);
      ren.set(r.no, nn);
    }
  });
  if (!ren.size) return local;
  const mv = (v?: string) => (v !== undefined && ren.has(v) ? (ren.get(v) as string) : v);
  const o: STables = { ...local };
  o.PO = (local.PO ?? []).map((r) => {
    const isNew = ren.has(r.no) && !inBase.has(r.no);
    return { ...r, no: isNew ? (mv(r.no) as string) : r.no, ...(r.prevNo ? { prevNo: mv(r.prevNo) as string } : {}) };
  });
  o.PO_Items = (local.PO_Items ?? []).map((r) => ({ ...r, no: mv(r.no) as string }));
  o.Change_History = (local.Change_History ?? []).map((r) => ({ ...r, no: inBase.has(r.no) ? r.no : (mv(r.no) as string) }));
  return o;
}
function mergeTables(base: STables, local0: STables, remote: STables): STables {
  const local = fixPoClash(base, local0, remote);
  const b = foldPO(base),
    l = foldPO(local),
    r = foldPO(remote);
  const out: STables = {};
  new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]).forEach((n) => {
    out[n] = mergeTable(n, b[n] ?? [], l[n] ?? [], r[n] ?? []);
  });
  return unfoldPO(out);
}
/** sheet terbaca kosong / menyusut drastis dibanding yang kita ketahui = gangguan atau terhapus, bukan perubahan sah */
function looksWiped(base: STables, remote: STables) {
  const g = (t: STables, n: string) => (t[n] ?? []).length;
  if (['Users', 'PO', 'Master_Supplier', 'Supplier_BP', 'Kategori', 'Departemen'].some((n) => g(base, n) >= 3 && g(remote, n) === 0))
    return true;
  return ['Users', 'PO'].some((n) => g(base, n) >= 6 && g(remote, n) < g(base, n) * 0.5);
}

/** Hook sinkron dua arah. Gambar (logo/background) TIDAK ikut: tetap tersimpan di aplikasi (po_brand). */
function useSheetSync(
  d: SyncData,
  set: {
    users: (v: User[]) => void;
    depts: (v: Dept[]) => void;
    taxes: (v: Tax[]) => void;
    cats: (v: Cat[]) => void;
    bps: (v: BP[]) => void;
    msup: (v: MSup[]) => void;
    pos: (v: PO[]) => void;
    hist: (v: Hist[]) => void;
    numCfg: (v: NumCfg) => void;
    theme: (v: number) => void;
    seen: (v: string[]) => void;
    brand: (v: Brand) => void;
  }
) {
  const [ok, setOk] = useState(false);
  const [kick, setKick] = useState(0); // memicu kirim ulang
  const brandKicked = useRef(false);
  const [status, setStatus] = useState<'' | 'sync' | 'saved' | 'error'>('');
  const last = useRef(''); // JSON isi sheet terakhir yang diketahui (basis penggabungan)
  const baseT = useRef<STables | null>(null); // isi sheet terakhir yang diketahui, dipakai untuk penggabungan 3 arah
  const rev = useRef<string | undefined>(undefined); // nomor revisi sheet (dari Code.gs baru)
  const wipe = useRef(0); // berapa kali berturut-turut sheet terbaca "kosong mencurigakan"
  const busy = useRef(false);
  const again = useRef(false);
  const cur = useRef(d);
  cur.current = d;
  const tablesRef = useRef<STables>({});
  const setters = useRef(set);
  setters.current = set;
  const tables = useMemo(
    () => toTables(d),
    [d.users, d.depts, d.taxes, d.cats, d.bps, d.msup, d.pos, d.hist, d.numCfg, d.theme, d.seen, d.brand]
  ); // eslint-disable-line react-hooks/exhaustive-deps

  tablesRef.current = tables;
  const applyState = (st: SyncData) => {
    const s = setters.current;
    s.users(st.users);
    s.depts(st.depts);
    s.taxes(st.taxes);
    s.cats(st.cats);
    s.bps(st.bps);
    s.msup(st.msup);
    s.pos(st.pos);
    s.hist(st.hist);
    s.numCfg(st.numCfg);
    s.theme(st.theme);
    s.seen(st.seen);
    s.brand(st.brand);
  };
  const api = async (body: Record<string, unknown>) => {
    const r = await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: SHEET_TOKEN, ...body }),
    });
    return (await r.json()) as {
      ok: boolean;
      error?: string;
      data?: STables;
      rev?: string;
    };
  };

  /** Satu putaran sinkron: BACA sheet -> GABUNG perubahan lokal ke data terbaru -> KIRIM hasil gabungan. Tidak pernah menimpa sheet dengan data lama. */
  const sync = async (first: boolean) => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    setStatus('sync');
    try {
      if (!SHEET_TOKEN) throw new Error('Token belum diisi: set VITE_SHEET_TOKEN di Vercel (Environment Variables) lalu Redeploy');
      for (let attempt = 0; attempt < 4; attempt++) {
        let j = await api({ action: 'read' }).catch(() => ({ ok: false } as Awaited<ReturnType<typeof api>>));
        if (!j.ok || !j.data) {
          // Code.gs lama belum diganti: baca lewat cara lama (GET)
          const r = await fetch(SHEET_URL + '?token=' + encodeURIComponent(SHEET_TOKEN), { cache: 'no-store' });
          j = await r.json();
        }
        if (!j.ok || !j.data) throw new Error(j.error || 'gagal');
        const remote = j.data;
        rev.current = j.rev;
        const sheetEmpty = Object.values(remote).every((x) => !x.length);
        if (sheetEmpty) {
          if (first && !baseT.current) {
            // sheet benar-benar baru: isi dengan data aplikasi saat ini
            const t = toTables(cur.current);
            const w = await api({ action: 'write', tables: t, rev: rev.current });
            if (w.ok) {
              baseT.current = t;
              last.current = JSON.stringify(t);
              rev.current = w.rev;
            }
          }
          setOk(true);
          setStatus('saved');
          return;
        }
        // PENGAMAN: sheet tiba-tiba kosong / menyusut drastis dibanding yang kita ketahui = gangguan baca atau terhapus -> JANGAN diikuti
        if (baseT.current && looksWiped(baseT.current, remote)) {
          wipe.current++;
          if (wipe.current >= 3) {
            // tetap bermasalah: pulihkan sheet dari data lengkap yang ada di aplikasi ini
            const w = await api({ action: 'write', tables: baseT.current, rev: rev.current, restore: true });
            if (w.ok) {
              rev.current = w.rev;
              wipe.current = 0;
            }
          }
          setStatus('error');
          return;
        }
        wipe.current = 0;
        const localT = toTables(cur.current);
        const dirty = !!baseT.current && JSON.stringify(localT) !== last.current;
        // SINKRON PERTAMA di browser ini: tabel Supplier BP / Master Supplier yang masih KOSONG di sheet tetapi berisi di aplikasi
        // dikirim ke sheet, bukan dibuang. (Dulu isi aplikasi diganti dengan tabel sheet yang kosong, sehingga data BP hilang.)
        let seeded = remote;
        if (!baseT.current) {
          const bpL = cur.current.bps;
          const seed: STables = { ...remote };
          if (!(remote.Supplier_BP ?? []).length && bpL.length && JSON.stringify(bpL) !== JSON.stringify(DEF_BP))
            seed.Supplier_BP = localT.Supplier_BP ?? [];
          if (!(remote.Master_Supplier ?? []).length && cur.current.msup.length)
            seed.Master_Supplier = localT.Master_Supplier ?? [];
          seeded = seed;
        }
        const merged =
          !baseT.current || !dirty
            ? seeded
            : mergeTables(baseT.current, localT, remote);
        const st = fromTables(merged, cur.current);
        const norm = toTables(st);
        const normKey = JSON.stringify(norm);
        const remoteKey = JSON.stringify(toTables(fromTables(remote, cur.current)));
        if (normKey !== JSON.stringify(localT)) applyState(st);
        if (normKey === remoteKey) {
          baseT.current = norm;
          last.current = normKey;
          break; // tidak ada yang perlu dikirim
        }
        const w = await api({ action: 'write', tables: norm, rev: rev.current });
        if (w.ok) {
          baseT.current = norm;
          last.current = normKey;
          rev.current = w.rev;
          break;
        }
        if (w.error === 'conflict') continue; // ada user lain menyimpan lebih dulu: baca ulang & gabung lagi
        if (w.error === 'shrink') {
          // server menolak karena data akan menyusut drastis: buang perubahan lokal, ikuti sheet
          baseT.current = remote;
          last.current = JSON.stringify(toTables(fromTables(remote, cur.current)));
          applyState(fromTables(remote, cur.current));
          throw new Error('shrink');
        }
        throw new Error(w.error || 'gagal');
      }
      // sheet belum menyimpan logo/background tetapi aplikasi ini punya: kirim sekali agar user lain ikut melihat
      if (
        !brandKicked.current &&
        baseT.current &&
        !(baseT.current.Tampilan && baseT.current.Tampilan.length) &&
        brandHas(cur.current.brand)
      ) {
        brandKicked.current = true;
        last.current = '';
        setKick((k) => k + 1);
      }
      SYNC_ERR = '';
      setStatus('saved');
      setOk(true);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      SYNC_ERR = /VITE_/.test(m)
        ? m
        : /token/i.test(m)
        ? 'Token salah / belum sama dengan Script property TOKEN di Apps Script'
        : /Failed to fetch|NetworkError|Unexpected token|JSON/i.test(m)
        ? 'Apps Script tidak bisa dijangkau: pastikan sudah di-Deploy versi baru dengan akses "Anyone", dan URL benar'
        : m === 'shrink'
        ? 'Perubahan ditolak server karena data akan menyusut drastis'
        : m;
      setStatus('error');
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        window.setTimeout(() => void sync(false), 300);
      }
    }
  };

  useEffect(() => {
    void sync(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ok) return;
    const tick = () => {
      if (!document.hidden) void sync(false);
    };
    const id = window.setInterval(tick, SHEET_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ok]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // perubahan aplikasi dikirim (setelah digabung dengan data terbaru) ditunda 1,5 dtk
    if (!ok) return;
    const key = JSON.stringify(tables);
    if (key === last.current) return;
    const id = window.setTimeout(() => void sync(false), 1500);
    return () => clearTimeout(id);
  }, [tables, ok, kick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // belum pernah berhasil terhubung ke Google Sheet: coba lagi otomatis tiap 8 detik
    if (ok) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void sync(true);
    }, 8000);
    return () => clearInterval(id);
  }, [ok]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // jangan biarkan perubahan yang belum terkirim hilang saat tab ditutup
    const h = (e: BeforeUnloadEvent) => {
      if (last.current && JSON.stringify(tablesRef.current) !== last.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const out: SyncStatus = ok
    ? status || 'saved'
    : status === 'error'
    ? 'offline'
    : 'loading';
  return out;
}

type SyncStatus = 'loading' | 'offline' | 'sync' | 'saved' | 'error';

let SYNC_ERR = ''; // alasan gagal sinkron terakhir (tampil di tooltip ikon)
function SyncChip({ st }: { st: SyncStatus }) {
  const m: Record<SyncStatus, [string, string]> = {
    loading: ['Menghubungkan ke Google Sheet\u2026', '#d99100'],
    offline: ['Tidak terhubung ke Google Sheet \u2013 data belum dibagikan. Mencoba ulang\u2026', '#d92d20'],
    sync: ['Menyinkronkan\u2026', '#2e7bd6'],
    error: ['Gagal sinkron, dicoba lagi otomatis', '#d92d20'],
    saved: ['Terhubung & tersinkron dengan Google Sheet', '#16a34a'],
  };
  const [text, col] = m[st];
  const bad = st === 'offline' || st === 'error';
  const tip = text + (bad && SYNC_ERR ? '\nPenyebab: ' + SYNC_ERR : '');
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={tip}
      title={tip}
      style={{
        position: 'fixed',
        top: 10,
        right: 12,
        zIndex: 99999,
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: col,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px ' + col + '88, 0 2px 6px rgba(0,0,0,.3)',
        cursor: 'help',
        animation: st === 'sync' || st === 'loading' ? 'agpPulse 1s ease-in-out infinite' : undefined,
      }}
    >
      <style>{'@keyframes agpPulse{0%,100%{opacity:1}50%{opacity:.35}}'}</style>
    </div>
  );
}

export default function App() {
  const [users, setUsers] = useLS<User[]>('po_users', [ADMIN]);
  const [pos, setPos] = useLS<PO[]>('po_list', []);
  const [sid, setSid] = useLS<string>('po_session', '');
  const [brand, setBrand] = useLS<Brand>('po_brand', BRAND0);
  const [catsRaw, setCatsRaw] = useLS<(Cat | string)[]>('po_cats', DEF_CATS); // data lama (string[]) otomatis dikonversi
  useEffect(() => {
    try {
      if (localStorage.getItem('po_cats_v') === CAT_VER) return;
      setCatsRaw((raw) => mergeCats(raw));
      localStorage.setItem('po_cats_v', CAT_VER);
    } catch {
      /* abaikan */
    }
  }, [setCatsRaw]);
  const cats = normCats(catsRaw);
  const setCats = (f: (c: Cat[]) => Cat[]) =>
    setCatsRaw((raw) => f(normCats(raw)));
  const [bps, setBps] = useLS<BP[]>('po_bp', DEF_BP);
  const [msup, setMsup] = useLS<MSup[]>('po_msup', []); // Master Supplier: diunggah admin, dipakai semua user
  const [numCfg, setNumCfg] = useLS<NumCfg>('po_numcfg', {});
  const [depts, setDepts] = useLS<Dept[]>('po_depts', DEF_DEPTS);
  const [taxes, setTaxes] = useLS<Tax[]>('po_taxes', DEF_TAXES);
  const deptNames = deptSort(depts);
  const [seen, setSeen] = useLS<string[]>('po_seen', []);
  const [hist, setHist] = useLS<Hist[]>('po_hist', []);
  const [page, setPage] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fk, setFk] = useState(0);
  const [fixedNo, setFixedNo] = useState<string | null>(null); // nomor PO yang sedang diperbaiki/dilihat (null = pengajuan baru)
  const [formRO, setFormRO] = useState(false); // form mode lihat saja (admin)
  const [toast, setToast] = useState('');
  const [fDept, setFDept] = useState('');
  const [gq, setGq] = useState('');
  const [gdraft, setGdraft] = useState('');
  const [fStat, setFStat] = useState('');
  const [viewNo, setViewNo] = useState('');
  const [prevPg, setPrevPg] = useState(''); // halaman sebelum membuka Dokumen PO (untuk tombol Kembali)
  const [, setBackTo] = useState(''); // halaman asal dokumen PO (mis. "tracking"); kosong = dibuka langsung, tanpa tombol kembali
  const [mdOpen, setMdOpen] = useState(true);
  /* Mode HP/tablet: sidebar menjadi drawer geser (dibuka lewat tombol hamburger) */
  const [navOpen, setNavOpen] = useState(false);
  /* Desktop: sidebar tertutup (ikon saja); terbuka ke kanan saat kursor/fokus berada di sidebar */
  const [sideHov, setSideHov] = useState(false);
  useEffect(() => {
    // Pastikan browser HP memakai lebar layar asli (bukan tampilan desktop yang diperkecil) dan aman dari poni/notch iPhone
    let m = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'viewport';
      document.head.appendChild(m);
    }
    m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
  }, []);
  useEffect(() => {
    setNavOpen(false);
  }, [sid]);
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // halaman di belakang drawer tidak ikut bergulir
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    const onSize = () => {
      if (window.innerWidth > 900) setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onSize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onSize);
    };
  }, [navOpen]);
  /* Sidebar: pill indikator menu aktif yang meluncur mulus ke menu yang dipilih */
  const navRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ t: number; h: number } | null>(null);
  const [pillAnim, setPillAnim] = useState(false);
  useLayoutEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector<HTMLElement>('.nv.on');
      setPill(el ? { t: el.offsetTop, h: el.offsetHeight } : null);
    };
    measure();
    const raf = requestAnimationFrame(() => setPillAnim(true)); // transisi aktif setelah posisi awal terpasang (tanpa animasi saat pertama muat)
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [page, mdOpen, sid, sideHov]);
  const [um, setUm] = useState(false);
  const [pwOpen, setPwOpen] = useState(false); // modal ganti password
  const [uq, setUq] = useState('');
  const [uPg, setUPg] = useState(1);
  const uRows = users
    .filter(
      (u) =>
        u.id !== ADMIN.id &&
        (!uq.trim() ||
          (u.nama + ' ' + uname(u) + ' ' + u.email + ' ' + u.dept)
            .toLowerCase()
            .includes(uq.trim().toLowerCase()))
    )
    .sort(
      (a, b) =>
        Number(b.status === 'pending') -
        Number(a.status === 'pending')
    );
  const uPages = Math.max(1, Math.ceil(uRows.length / 15));
  const uPgSafe = Math.min(uPg, uPages);
  const [per, setPer] = useState<PSel>(() => {
    const d = new Date();
    return { type: 'monthly', year: d.getFullYear(), n: d.getMonth() };
  });
  const [themeG, setThemeG] = useLS<number>('po_theme', 0); // tema bawaan sistem: diatur admin, tersimpan
  const syncSt = useSheetSync(
    { users, depts, taxes, cats, bps, msup, pos, hist, numCfg, theme: themeG, seen, brand },
    {
      users: setUsers,
      depts: setDepts,
      taxes: setTaxes,
      cats: setCatsRaw,
      bps: setBps,
      msup: setMsup,
      pos: setPos,
      hist: setHist,
      numCfg: setNumCfg,
      theme: setThemeG,
      seen: setSeen,
      brand: setBrand as (v: Brand) => void,
    }
  );
  const [themeU, setThemeU] = useState<number | null>(null); // tema sementara user: tidak disimpan, hilang saat keluar / muat ulang
  const [thOpen, setThOpen] = useState(false);
  const [thPrev, setThPrev] = useState<{ g: number; u: number | null }>({
    g: 0,
    u: null,
  }); // tema sebelum popover dibuka, untuk tombol Kembali

  // Pastikan akun admin selalu sesuai dengan data ADMIN di atas (menimpa data lama di browser)
  useEffect(() => {
    setUsers((l) => {
      const a = l.find((u) => u.id === 'admin');
      if (!a) return [ADMIN, ...l];
      // jaga identitas/hak akses admin, tetapi JANGAN menimpa password yang sudah diganti
      return a.username === ADMIN.username &&
        a.role === 'admin' &&
        a.status === 'approved' &&
        a.pass
        ? l
        : l.map((u) =>
            u.id === 'admin'
              ? { ...ADMIN, email: u.email || ADMIN.email, pass: u.pass || ADMIN.pass }
              : u
          );
    });
  }, [setUsers]);

  // Data contoh (user + PO 6 bulan) dengan daftar departemen baru, dimuat satu kali. Data contoh lama (id "demo-") dibuang dan dibuat ulang.
  // Data asli tidak dihapus; nama departemen versi lama pada data asli dipindah ke departemen baru (lihat LEGACY_DEPT).
  // Nomor PO lama yang memakai kode departemen diseragamkan menjadi kode GA. Untuk memuat ulang: hapus kunci "po_seed_v3" di localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem('po_seed_v3')) return;
      localStorage.setItem('po_seed_v3', '1');
      localStorage.setItem('po_seed_v2', '1');
      localStorage.setItem('po_seed_v1', '1');
    } catch {
      return;
    }
    const known = new Set(DEF_DEPTS.map((d) => d.nama));
    const fix = (d: string) =>
      !known.has(d) && LEGACY_DEPT[d] ? LEGACY_DEPT[d] : d;
    const fixNo = (n: string) =>
      n.replace(/^(\d+\/AGP-PO\/)[^/]+(\/)/, `$1${PO_CODE}$2`);
    setUsers((l) => {
      const keep = l
        .filter((u) => !u.id.startsWith('demo-'))
        .map((u) => ({ ...u, dept: fix(u.dept) }));
      return [
        ...keep,
        ...(SEED_DEMO
          ? DEMO_USERS.filter((d) => !keep.some((u) => u.email === d.email))
          : []),
      ];
    });
    setPos((l) => {
      const keep = l
        .filter((x) => !x.uid.startsWith('demo-'))
        .map((x) => ({ ...x, no: fixNo(x.no), dept: fix(x.dept) }));
      const base: Record<number, number> = {};
      keep.forEach((x) => {
        const m = /^(\d+)\/AGP-PO\/[^/]+\/[^/]+\/(\d{4})$/.exec(x.no);
        if (m)
          base[Number(m[2])] = Math.max(base[Number(m[2])] ?? 0, Number(m[1]));
      });
      return SEED_DEMO ? [...keep, ...makeDemoPOs(base)] : keep;
    });
  }, [setUsers, setPos]);

  // PO contoh 44 item (meniru PO PDF contoh) dimuat satu kali. Muat ulang: hapus kunci "po_seed_ref_v1" di localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem('po_seed_ref_v1')) return;
      localStorage.setItem('po_seed_ref_v1', '1');
    } catch {
      return;
    }
    if (!SEED_DEMO) return;
    setPos((l) =>
      l.some((x) => x.uid === 'dummy-ref')
        ? l
        : [makeRefPO(new Set(l.map((x) => x.no))), ...l]
    );
  }, [setPos]);

  // Migrasi satu kali: dulu tombol Done admin otomatis mengisi tanggal tahap "PO di-approve" (tanda tangan atasan).
  // Bersihkan tanggal otomatis itu: PO Done, tanggal appr = tanggal doneAt, dan belum ada tahap sesudahnya yang terisi.
  // Untuk menjalankan ulang: hapus kunci "po_appr_fix_v1" di localStorage.
  useEffect(() => {
    try {
      if (localStorage.getItem('po_appr_fix_v1')) return;
      localStorage.setItem('po_appr_fix_v1', '1');
    } catch {
      return;
    }
    setPos((l) =>
      l.map((x) => {
        const a = x.trk?.appr;
        if (!a || !x.doneAt || x.uid.startsWith('demo-') || x.uid === 'dummy-ref')
          return x;
        const later = (['supp', 'hoSend', 'hoRecv', 'recv', 'pay'] as TKey[]).some(
          (k) => !!x.trk?.[k]
        );
        if (later || a !== ymd(new Date(x.doneAt))) return x;
        const trk = { ...x.trk };
        delete trk.appr;
        return { ...x, trk };
      })
    );
  }, [setPos]);

  // Data contoh Change History (dummy) untuk admin: dibuat sekali dari data contoh user & PO yang ada. Muat ulang: hapus kunci "po_hist_seed_v1".
  useEffect(() => {
    if (!pos.some((x) => x.uid.startsWith('demo-'))) return;
    try {
      if (localStorage.getItem('po_hist_seed_v1')) return;
      localStorage.setItem('po_hist_seed_v1', '1');
    } catch {
      return;
    }
    const seed = makeDemoHist(pos, users);
    setHist((l) =>
      [...l, ...seed].sort((a, b) => b.iso.localeCompare(a.iso)).slice(0, 1000)
    );
  }, [pos, users, setHist]);

  const me = users.find((u) => u.id === sid && u.status === 'approved');

  // Akun demo yang sudah terlanjur ada: dinonaktifkan saat admin login (password demo sudah umum diketahui). Admin bisa mengaktifkan kembali bila perlu.
  useEffect(() => {
    if (SEED_DEMO || !me || me.role !== 'admin') return;
    if (!users.some((u) => u.id.startsWith('demo-') && u.status !== 'rejected')) return;
    setUsers((l) =>
      l.map((u) =>
        u.id.startsWith('demo-') && u.status !== 'rejected'
          ? { ...u, status: 'rejected' }
          : u
      )
    );
    notify('Akun demo (password umum) otomatis dinonaktifkan demi keamanan.');
  }, [me?.id, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // Admin login: password lama (teks biasa) milik semua akun di-hash sekali jalan, sehingga tidak ada lagi password terbaca di sheet.
  useEffect(() => {
    if (!me || me.role !== 'admin' || !users.some((u) => u.pass && !isHashed(u.pass))) return;
    let off = false;
    void (async () => {
      try {
        const m = new Map<string, string>();
        for (const u of users)
          if (u.pass && !isHashed(u.pass)) m.set(u.id, await hashPw(u.pass));
        if (!off && m.size)
          setUsers((l) => l.map((u) => (m.has(u.id) ? { ...u, pass: m.get(u.id)! } : u)));
      } catch {
        /* abaikan */
      }
    })();
    return () => {
      off = true;
    };
  }, [me?.id, me?.role, users, setUsers]); // eslint-disable-line react-hooks/exhaustive-deps
  // Login dengan password default/lemah: modal ganti password dibuka otomatis
  useEffect(() => {
    if (me && WEAK_LOGIN) {
      WEAK_LOGIN = false;
      setPwOpen(true);
      notify('Password Anda masih default/lemah. Segera ganti dengan password baru (min. 8 karakter).');
    }
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Auto-logout: bila sudah login dan tidak ada gerakan kursor / klik / ketikan / scroll / sentuhan selama IDLE_MS, otomatis keluar. */
  useEffect(() => {
    if (!me) return;
    let t = 0;
    const out = () => {
      try {
        sessionStorage.setItem('po_idle', '1');
      } catch {
        /* abaikan */
      }
      setSid('');
      setPage('');
      setThemeU(null);
      setThOpen(false);
      setUm(false);
    };
    const reset = () => {
      clearTimeout(t);
      t = window.setTimeout(out, IDLE_MS);
    };
    const evs = [
      'mousemove',
      'mousedown',
      'keydown',
      'wheel',
      'scroll',
      'touchstart',
      'touchmove',
      'pointerdown',
    ];
    evs.forEach((e) =>
      window.addEventListener(e, reset, { passive: true, capture: true })
    );
    reset();
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset, true));
    };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Supplier yang diketik di form PO otomatis masuk Master Supplier (bila belum ada) dan ikut tersinkron ke semua user.
      Bila sudah ada, hanya kolom yang masih kosong yang dilengkapi; data lama tidak ditimpa. */
  const autoSupplier = (p: PO) => {
    const nama = p.v.nama.trim();
    if (!nama) return;
    const k = supKey(nama);
    const pay = p.pay ?? EMPTY_PAY;
    const inc: MsRow = {
      nama,
      alamat: p.v.alamat.trim(),
      provinsi: '',
      npwp: p.v.npwp.trim(),
      telp: p.v.telp.trim(),
      fax: p.v.fax.trim(),
      pic: p.v.pic.trim(),
      dept: p.dept ?? '',
      email: p.v.email.trim(),
      rek: pay.rek.trim(),
      bank: pay.bank.trim(),
      cabang: pay.cabang.trim(),
      an: pay.an.trim(),
    };
    setMsup((l) => {
      const i = l.findIndex((m) => supKey(m.nama) === k);
      if (i < 0) {
        const ids = new Set(l.map((m) => m.id));
        let id = 'ms-' + hash32(k).toString(36);
        for (let c = 2; ids.has(id); c++) id = 'ms-' + hash32(k).toString(36) + '-' + c;
        return [...l, { id, ...inc }];
      }
      const o = l[i];
      const n = { ...o };
      MS_KEYS.forEach(({ k: f }) => {
        if (!(n[f] ?? '').trim() && inc[f]) n[f] = inc[f];
      });
      return JSON.stringify(n) === JSON.stringify(o) ? l : l.map((m, j) => (j === i ? n : m));
    });
  };
  // Catat siapa mengubah apa, kapan, pada PO mana (maks. 1000 baris terakhir disimpan)
  const logH = (no: string, what: string) => {
    if (!me) return;
    setHist((l) =>
      [
        {
          id: newId('h-'),
          iso: new Date().toISOString(),
          uid: me.id,
          by: me.nama,
          dept: me.dept,
          no,
          what,
        },
        ...l,
      ].slice(0, 1000)
    );
  };
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(''), 2300);
  };

  // (hook harus di atas 'if (!me)' agar urutan hook tetap sama saat logout)
  const [shownPw, setShownPw] = useState<Record<string, string>>({}); // password sementara hasil reset, hanya di layar admin (tidak disimpan)
  const hue = me?.role === 'admin' ? themeG : themeU ?? themeG;
  if (!me)
    return (
      <>
        <style>{themed(css, themeG)}</style>
        <Auth
          tint={themeG !== 0}
          brand={brand}
          depts={deptNames}
          users={users}
          setUsers={setUsers}
          sync={syncSt}
          onLogin={(id) => {
            setSid(id);
            setPage('');
          }}
        />
        <SyncChip st={syncSt} />
      </>
    );

  const admin = me.role === 'admin';
  // Halaman khusus admin: user biasa tidak memiliki menu ini dan tidak bisa membukanya (diarahkan ke Buat PO Request)
  const cur0 = page || (admin ? 'dash' : 'form');
  const cur = !admin && ADMIN_ONLY.has(cur0) ? 'form' : cur0;
  const pending = users.filter((u) => u.status === 'pending').length;
  const scope = admin ? pos : pos.filter((p) => sameDept(p.dept, me.dept));
  const mine = pos.filter((p) => p.uid === me.id);
  const openCnt = scope.filter(isWait).length;
  const unread = mine.filter(
    (p) =>
      (p.status === 'Done' || !!p.rej) && !seen.includes(notifKey(me.id, p))
  ).length;
  const match = (p: PO, k: string) =>
    !k.trim() ||
    (
      p.no +
      ' ' +
      p.v.nama +
      ' ' +
      p.by +
      ' ' +
      p.items.map((i) => i.d).join(' ')
    )
      .toLowerCase()
      .includes(k.trim().toLowerCase());

  const main: Nav[] = admin
    ? [
        { k: 'dash', l: 'Dashboard', ic: 'home' },
        { k: 'all', l: 'Semua Pengajuan', ic: 'fileList', bd: openCnt },
        { k: 'doc', l: 'Dokumen PO', ic: 'file' },
        { k: 'tracking', l: 'Tracking PO', ic: 'truck' },
        { k: 'users', l: 'Verifikasi User', ic: 'user', bd: pending },
        { k: 'supplier', l: 'Data Supplier', ic: 'users' },
        { k: 'history', l: 'Change History', ic: 'clock' },
      ]
    : [
        { k: 'dash', l: 'Dashboard', ic: 'home' },
        { k: 'form', l: 'Buat PO Request', ic: 'filePlus' },
        { k: 'riwayat', l: 'Riwayat Pengajuan', ic: 'fileList' },
        { k: 'approval', l: 'Menunggu Approval', ic: 'clock', bd: openCnt },
        { k: 'tracking', l: 'Tracking PO', ic: 'truck' },
        { k: 'supplier', l: 'Data Supplier', ic: 'users' },
        { k: 'notif', l: 'Notifikasi', ic: 'bell', bd: unread },
      ];
  const master: Nav[] = [
    { k: 'kategori', l: 'Kategori Barang/Jasa', ic: 'box' },
    { k: 'supplier', l: 'Data Supplier', ic: 'users' },
    { k: 'barang', l: 'Daftar Barang', ic: 'box' },
  ];

  const go = (k: string) => {
    setBackTo('');
    setPrevPg(cur);
    if (k === 'form') {
      setFixedNo(null); // form baru dari sidebar, bukan perbaikan/lihat
      setFormRO(false);
    }
    setPage(k);
    setUm(false);
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };
  // Isian form dari PO yang sudah ada (dipakai Edit PO & Lihat Form): vendor,
  // pembayaran, item (+kategori di k), pajak/discount/ongkir/catatan & tanggal awal.
  const fillDraft = (p: PO): Draft => ({
    v: { ...p.v },
    pay: { ...(p.pay ?? EMPTY_PAY) },
    items: p.items.map((l) =>
      newItem({
        d: l.d,
        q: String(l.q),
        s: l.s,
        p: String(l.p),
        k: l.k ?? '',
      })
    ),
    disc: String(p.disc),
    ong: String(p.ong ?? ''),
    rate: String(p.rate),
    note: p.note ?? '',
    iso: p.iso,
  });
  // User: perbaiki PO yang ditolak — form terbuka terisi data PO lama, nomor tetap sama.
  const editPo = (p: PO) => {
    if (admin) return notify('Edit pengajuan hanya tersedia untuk akun user.');
    if (p.rejFinal)
      return notify('PO Reject (final) tidak bisa diedit. Buat PO baru.');
    setDraft(fillDraft(p));
    setFixedNo(p.no);
    setFormRO(false);
    setFk((k) => k + 1);
    setPage('form');
    notify(
      'Perbaiki isian yang salah, lalu kirim ulang. Nomor pengajuan tetap sama.'
    );
  };
  // User: PO sudah di-reject final -> buka form baru terisi data lama; nomor PO baru (bertambah) dibuat otomatis.
  const newFromRejected = (p: PO) => {
    if (admin) return notify('Pembuatan PO baru hanya tersedia untuk akun user.');
    if (p.uid !== me.id || !p.rejFinal || p.newNo) return;
    setFixedNo(null);
    setFormRO(false);
    setDraft({ ...fillDraft(p), iso: undefined, prev: p.no });
    setFk((k) => k + 1);
    setPage('form');
    notify(
      `PO ${p.no} sudah di-reject. Periksa isian, lalu kirim sebagai PO baru (nomor baru dibuat otomatis).`
    );
  };
  // Admin: lihat isian form pengajuan secara lengkap (mode lihat saja).
  const viewForm = (p: PO) => {
    if (!admin) return;
    setDraft(fillDraft(p));
    setFixedNo(p.no);
    setFormRO(true);
    setFk((k) => k + 1);
    setPage('form');
  };
  const copy = (p: PO, all: boolean) => {
    if (admin) return notify('Salin pengajuan hanya tersedia untuk akun user.');
    setFixedNo(null);
    setFormRO(false);
    setDraft({
      v: { ...p.v },
      pay: { ...(p.pay ?? EMPTY_PAY) },
      items: all
        ? p.items.map((l) =>
            newItem({
              d: l.d,
              q: String(l.q),
              s: l.s,
              p: String(l.p),
              k: l.k ?? '',
            })
          )
        : [newItem()],
    });
    setFk((k) => k + 1);
    setPage('form');
    notify(
      all
        ? 'Vendor, pembayaran & item disalin. Sesuaikan isian, nomor pengajuan baru dibuat otomatis.'
        : 'Data vendor & pembayaran disalin. Lengkapi item barang.'
    );
  };
  const useSupplier = (r: SupRow) => {
    setFixedNo(null);
    setFormRO(false);
    setDraft({
      v: { ...r.v },
      pay: { ...(r.pay ?? EMPTY_PAY) },
      items: [newItem()],
    });
    setFk((k) => k + 1);
    setPage('form');
    notify('Data supplier disalin. Lengkapi item barang.');
  };
  const useMaster = (m: MSup) => {
    setFixedNo(null);
    setFormRO(false);
    setDraft({
      v: msToVendor(m),
      pay: msToPay(m),
      items: [newItem()],
    });
    setFk((k) => k + 1);
    setPage('form');
    notify('Data supplier & pembayaran terisi dari Master Supplier. Lengkapi item barang.');
  };
  const useBarang = (r: ItemRow) => {
    setFixedNo(null);
    setFormRO(false);
    setDraft({
      v: EMPTY,
      pay: EMPTY_PAY,
      items: [newItem({ d: r.d, s: r.s, p: String(r.p), k: r.k })],
    });
    setFk((k) => k + 1);
    setPage('form');
    notify('Barang ditambahkan ke form. Isi qty dan data vendor.');
  };
  // admin: buka halaman Dokumen PO dengan nomor terpilih; user: tampil popup dokumen
  const openDoc = (no: string) => {
    setBackTo('');
    setViewNo(no);
    if (admin) {
      if (cur !== 'doc') setPrevPg(cur);
      setPage('doc');
    }
  };
  // dari Tracking PO: sama seperti openDoc, tetapi mengingat asalnya agar ada tombol Kembali
  const openDocFromTracking = (no: string) => {
    setViewNo(no);
    if (admin) {
      if (cur !== 'doc') setPrevPg(cur);
      setPage('doc');
    }
  };
  const backPg = prevPg && prevPg !== 'doc' ? prevPg : 'all';
  const backFromDoc = () => {
    setBackTo('');
    setPage(backPg);
    window.scrollTo({ top: 0 });
  };
  // periode tahun yang terkunci: PO pada tahun itu tidak bisa diubah (approve, tolak, buka lagi, tracker)
  const lockedOf = (p: PO) => lockedYear(numCfg, new Date(p.iso).getFullYear());
  const guard = (no: string) => {
    const p = pos.find((x) => x.no === no);
    if (!p || !lockedOf(p)) return false;
    notify(
      `Periode ${new Date(
        p.iso
      ).getFullYear()} terkunci. Buka kunci di Pengaturan untuk mengubah.`
    );
    return true;
  };
  const markDone = (no: string) => {
    if (guard(no)) return;
    const p0 = pos.find((x) => x.no === no);
    if (p0) {
      const { bp, bi } = bpOfPo(bps, p0);
      if (
        (!bp || !bi || bi.expired) &&
        !window.confirm(`${bpWhy(bps, p0)}.\n\nTetap tandai Done?`)
      )
        return;
    }
    logH(no, 'Status PO ditandai Done (disetujui admin)');
    setPos((l) =>
      l.map((p) =>
        p.no === no
          ? {
              ...p,
              status: 'Done',
              doneAt: new Date().toISOString(),
            }
          : p
      )
    );
    notify('Ditandai Done. User melihat: PO sudah bisa dicetak.');
  };
  // Catat setiap cetak PO. Cetak pertama: tombol berubah merah. Cetak berikutnya hanya lewat izin admin dan tercatat di riwayat.
  const markPrinted = (no: string) => {
    const p0 = pos.find((x) => x.no === no);
    if (!p0) return;
    const n = (p0.printN ?? 0) + 1;
    logH(
      no,
      n === 1 ? 'PO dicetak/diunduh (pertama kali)' : `PO dicetak/diunduh (ke-${n})`
    );
    setPos((l) =>
      l.map((p) =>
        p.no === no
          ? { ...p, printN: n, printAt: new Date().toISOString(), printOk: undefined }
          : p
      )
    );
  };
  const allowReprint = (no: string) => {
    const p0 = pos.find((x) => x.no === no);
    if (!p0 || me?.role !== 'admin') return;
    logH(no, `Admin mengizinkan cetak ulang PO (sudah dicetak ${p0.printN ?? 0}×)`);
    setPos((l) =>
      l.map((p) => (p.no === no ? { ...p, printOk: new Date().toISOString() } : p))
    );
    notify('Cetak ulang diizinkan. User bisa mencetak PO ini satu kali lagi.');
  };
  const setTrk = (no: string, k: TKey, v: string) => {
    if (guard(no)) return;
    const old = pos.find((x) => x.no === no)?.trk?.[k];
    if ((old ?? '') === v) return;
    const lbl = TSTEPS.find((x) => x.k === k)?.l ?? k;
    logH(
      no,
      v
        ? old
          ? `${lbl}: tanggal diubah ${fmtD(old)} → ${fmtD(v)}`
          : `${lbl}: tanggal diisi ${fmtD(v)}`
        : `${lbl}: tanggal dihapus (sebelumnya ${old ? fmtD(old) : '-'})`
    );
    setPos((l) =>
      l.map((p) => {
        if (p.no !== no) return p;
        const trk = { ...p.trk };
        if (v) trk[k] = v;
        else delete trk[k];
        return k === 'supp' && !v
          ? { ...p, trk, suppLink: undefined }
          : { ...p, trk };
      })
    );
    notify(v ? 'Tracker diperbarui.' : 'Tanggal tahap dihapus.');
  };
  const reopen = (no: string) => {
    if (guard(no)) return;
    if (pos.find((x) => x.no === no)?.rejFinal)
      return notify('PO Reject (final) tidak bisa dibuka lagi. User membuat PO baru.');
    logH(no, 'Status PO dibuka kembali (Open)');
    setPos((l) =>
      l.map((p) =>
        p.no === no
          ? {
              ...p,
              status: 'Open',
              doneAt: undefined,
              rej: undefined,
              rejWhy: undefined,
            }
          : p
      )
    );
  };
  /** Admin: Cancel Pengajuan. PO tidak masuk daftar lagi dan nomornya dilepas: pengajuan berikutnya memakai nomor ini.
   *  (Beda dengan PO Reject: nomor tetap, PO tetap tampil sebagai Rejected dan tercatat di history.) */
  const reject = (no: string) => {
    if (guard(no)) return;
    const p0 = pos.find((x) => x.no === no);
    if (!p0) return;
    const why = window.prompt(
      `Cancel pengajuan ${no}?\nPO ini tidak akan terdaftar lagi dan nomor ${no} dipakai oleh pengajuan berikutnya.\n\nAlasan pembatalan (dicatat di Change History):`,
      ''
    );
    if (why === null) return;
    const reason = why.trim() || 'Dibatalkan oleh admin';
    logH(
      no,
      `Pengajuan dibatalkan (Cancel): ${reason}. Nomor ${no} dilepas dan dipakai pengajuan berikutnya`
    );
    const sq = seqOf(no);
    if (sq)
      setNumCfg((c) => {
        const cur = c[sq.y] ?? {};
        return {
          ...c,
          [sq.y]: {
            ...cur,
            free: Array.from(new Set([...(cur.free ?? []), sq.n])).sort(
              (a, b) => a - b
            ),
          },
        };
      });
    setPos((l) =>
      l
        .filter((p) => p.no !== no)
        .map((p) =>
          p0.prevNo && p.no === p0.prevNo ? { ...p, newNo: undefined } : p
        )
    );
    notify(
      `Pengajuan dibatalkan. Nomor ${no} tidak terdaftar dan akan dipakai pengajuan berikutnya.`
    );
  };
  /** Admin: PO Reject (final). PO lama terkunci (tidak bisa diedit/dikirim ulang/dibuka lagi), user membuat PO baru dengan nomor baru. */
  const poReject = (no: string) => {
    if (guard(no)) return;
    const p0 = pos.find((x) => x.no === no);
    if (!p0 || p0.rejFinal) return;
    const why = window.prompt(
      `PO Reject ${no}\nPO ini tidak bisa diedit lagi dan user harus membuat PO baru (nomor baru).\n\nKeterangan reject (wajib diisi):`,
      p0.rejWhy ?? ''
    );
    if (why === null) return;
    const reason = why.trim();
    if (!reason) return notify('Keterangan reject wajib diisi.');
    logH(no, `PO Reject (final): ${reason}. User membuat PO baru dengan nomor baru.`);
    setPos((l) =>
      l.map((p) =>
        p.no === no
          ? {
              ...p,
              rej: new Date().toISOString(),
              rejWhy: reason,
              rejFinal: true,
              status: 'Open',
              doneAt: undefined,
            }
          : p
      )
    );
    notify('PO di-reject. User menerima notifikasi untuk membuat PO baru.');
  };
  /** User pembuat PO: lanjutkan PO yang ditolak tanpa membuat ulang; status kembali menunggu admin. */
  const resend = (p: PO) => {
    if (p.uid !== me.id || !p.rej || p.rejFinal || guard(p.no)) return;
    if (
      !window.confirm(
        'Kirim ulang pengajuan ini ke admin? PO yang sama akan diproses kembali.'
      )
    )
      return;
    logH(
      p.no,
      'Pengajuan dikirim ulang oleh user (dilanjutkan setelah ditolak)'
    );
    setPos((l) =>
      l.map((x) =>
        x.no === p.no
          ? {
              ...x,
              rej: undefined,
              rejWhy: undefined,
              resent: new Date().toISOString(),
            }
          : x
      )
    );
    notify('Pengajuan dikirim ulang. Admin akan memprosesnya kembali.');
  };
  const setUserStatus = (id: string, s: User['status']) => {
    const u = users.find((x) => x.id === id);
    if (!u || u.status === s) return;
    setUsers((l) => l.map((x) => (x.id === id ? { ...x, status: s } : x)));
    const act =
      s === 'approved'
        ? u.status === 'pending'
          ? 'Approve anggota baru'
          : 'Aktifkan kembali akun'
        : u.status === 'approved'
        ? 'Nonaktifkan akun'
        : 'Reject pendaftaran';
    logH('-', `${act}: ${u.nama} (${u.email})`);
    if (s === 'approved')
      void sendMail(u.email, 'Akun PO Request System sudah aktif', mailActivated(u)).then(
        (ok) =>
          notify(
            ok
              ? `Akun ${u.nama} aktif. Email notifikasi terkirim ke ${u.email}.`
              : `Akun ${u.nama} aktif, tetapi email notifikasi gagal terkirim.`
          )
      );
  };
  /** Ganti password akun sendiri. Mengembalikan pesan error, atau "" bila berhasil. */
  const changePw = async (o: string, n: string) => {
    if (!(await verifyPw(o, me.pass))) return 'Password lama salah.';
    if (n.length < 8) return 'Password baru minimal 8 karakter.';
    if (n === o) return 'Password baru harus berbeda dari password lama.';
    if (PW_WEAK.includes(n.toLowerCase())) return 'Password terlalu mudah ditebak.';
    const h = await hashPw(n);
    setUsers((l) => l.map((u) => (u.id === me.id ? { ...u, pass: h } : u)));
    WEAK_LOGIN = false;
    logH('-', 'Ganti password akun sendiri');
    return '';
  };
  /** Admin: ubah hak akses (role) akun. Admin = akses penuh semua menu; User = menu terbatas. Akun admin utama & akun sendiri tidak bisa diubah. */
  const setUserRole = (u: User, role: User['role']) => {
    if (u.role === role || u.id === ADMIN.id || u.id === me.id) return;
    const lbl = (r: User['role']) => (r === 'admin' ? 'Admin' : 'User');
    const msg =
      role === 'admin'
        ? `Jadikan ${u.nama} sebagai Admin?\nAkun ini akan mendapat akses penuh: Semua Pengajuan, Verifikasi User, Change History, dan Pengaturan.`
        : `Ubah ${u.nama} menjadi User biasa?\nAkses Semua Pengajuan, Verifikasi User, Change History, dan Pengaturan akan dicabut.`;
    if (!window.confirm(msg)) return;
    setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, role } : x)));
    logH(
      '-',
      `Ubah hak akses ${u.nama} (${u.email}): ${lbl(u.role)} → ${lbl(role)}`
    );
    notify(`Hak akses ${u.nama} diubah menjadi ${lbl(role)}.`);
  };
  /** Admin: reset password user menjadi password sementara (ditampilkan di tabel agar bisa diberikan ke user). */
  const resetPw = async (u: User) => {
    if (
      !window.confirm(
        `Reset password ${u.nama}?\n\nPassword lama diganti dengan password sementara baru yang dikirim otomatis ke ${u.email}.`
      )
    )
      return;
    const tmp = tmpPw();
    const th = await hashPw(tmp);
    setUsers((l) => l.map((x) => (x.id === u.id ? { ...x, pass: th } : x)));
    logH('-', `Reset password akun ${u.nama} (${u.email})`);
    notify(`Password ${u.nama} direset. Mengirim email ke ${u.email}...`);
    const ok = await sendMail(u.email, 'Password akun PO Request System direset', mailReset(u, tmp));
    if (ok) notify(`Password baru ${u.nama} sudah dikirim ke ${u.email}.`);
    else {
      // email gagal: tampilkan password di tabel agar admin bisa memberikannya manual
      setShownPw((m) => ({ ...m, [u.id]: tmp }));
      notify(`Email ke ${u.email} GAGAL terkirim. Password sementara ditampilkan di tabel, berikan ke user secara manual.`);
    }
  };
  const readOne = (no: string) => {
    const p = pos.find((x) => x.no === no);
    if (!p) return;
    const k = notifKey(me.id, p);
    setSeen((l) => (l.includes(k) ? l : [...l, k]));
  };
  const readAll = () =>
    setSeen((l) => [
      ...new Set([...l, ...mine.map((p) => notifKey(me.id, p))]),
    ]);
  const viewAll = (f: string) => {
    if (admin) {
      setFStat(f);
      setFDept('');
      setGq('');
      setGdraft('');
      go('all');
    } else go(f === 'Open' ? 'approval' : 'riwayat');
  };
  const submitSearch = () => {
    setGq(gdraft);
    setPage(admin ? 'all' : 'riwayat');
  };

  const exportCsv = (list: PO[] = pos) => {
    const rows = [
      [
        'No Pengajuan',
        'Waktu Submit',
        'Departemen',
        'Pemohon',
        'Vendor',
        'NPWP',
        'Bank',
        'No Rekening',
        'Kantor Cabang',
        'Atas Nama',
        'Deskripsi',
        'Kategori',
        'Qty',
        'Satuan',
        'Harga',
        'Total Item',
        'Pajak',
        'Discount',
        'Ongkir',
        'Grand Total',
        'Status',
        'Waktu Done',
        'Kategori Nilai',
        'Keterangan Reject',
      ],
    ];
    list.forEach((p) =>
      p.items.forEach((l) =>
        rows.push([
          p.no,
          fmtDT(p.iso),
          p.dept,
          p.by,
          p.v.nama,
          p.v.npwp,
          p.pay?.bank ?? '',
          p.pay?.rek ?? '',
          p.pay?.cabang ?? '',
          p.pay?.an ?? '',
          l.d,
          l.k ?? '',
          String(l.q),
          l.s,
          String(l.p),
          String(l.q * l.p),
          taxName(p.rate),
          String(p.disc),
          String(p.ong ?? 0),
          String(p.total),
          p.status === 'Done' ? 'Done' : p.rej ? 'Rejected' : 'Open',
          p.doneAt ? fmtDT(p.doneAt) : '',
          isBig(p) ? 'Di atas Rp 10 juta (approve Managing Director)' : 'Di bawah Rp 10 juta',
          p.rejFinal ? `PO Reject: ${p.rejWhy ?? ''}${p.newNo ? ` (diganti ${p.newNo})` : ''}` : p.rejWhy ?? '',
        ])
      )
    );
    const csv = rows
      .map((r) =>
        r
          .map((c) => `"${(/^[=+\-@\t\r]/.test(c) ? "'" + c : c).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = 'pengajuan-po.csv';
    a.click();
  };

  const viewPo = pos.find((p) => p.no === viewNo && sameDept(p.dept, me.dept));
  const meta = META[cur] ?? META.dash;
  const initials =
    me.nama
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'U';
  const bellN = admin ? pending + openCnt : unread;
  const nv = (n: Nav, sub = false) => (
    <button
      key={n.l + n.k}
      className={
        'nv' + (cur === n.k && !(sub && n.k === 'supplier') ? ' on' : '')
      }
      onClick={() => go(n.k)}
    >
      <Ic n={n.ic} s={sub ? 15 : 17} />
      <span>{n.l}</span>
      {!!n.bd && <em className="bd">{n.bd}</em>}
    </button>
  );

  return (
    <>
      <style>{themed(css, hue)}</style>
      <SyncChip st={syncSt} />
      <div className={'shell' + (sideHov ? ' sidehov' : '')}>
        <div
          className={'navmask' + (navOpen ? ' show' : '')}
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={
            'side' + (navOpen ? ' open' : '') + (sideHov ? ' hov' : '')
          }
          id="sidenav"
          onMouseEnter={() => setSideHov(true)}
          onMouseLeave={() => setSideHov(false)}
          onFocus={() => setSideHov(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setSideHov(false);
          }}
        >
          {/* bagian atas: logo, warna mengikuti background dashboard */}
          <div className="stop">
            <div className={'brand' + ((brand.sideBox ?? true) ? '' : ' nobox')}>
              <SideLogo src={brand.side} box={brand.sideBox} />
              <b>PO REQUEST SYSTEM</b>
            </div>
          </div>
          {/* panel biru berisi menu */}
          <div className="spanel">
          <SideFx />
          <button
            type="button"
            className="sclose"
            aria-label="Tutup menu"
            onClick={() => setNavOpen(false)}
          >
            <Ic n="x" s={18} />
          </button>
          <nav className="navlist" aria-label="Menu utama" ref={navRef}>
            {pill && (
              <span
                className={'navpill' + (pillAnim ? ' go' : '')}
                style={{ transform: `translateY(${pill.t}px)`, height: pill.h }}
                aria-hidden="true"
              />
            )}
            {main.map((n) => nv(n))}
            <div className="sep" />
            <button
              className="nv grp"
              onClick={() => setMdOpen((x) => !x)}
              aria-expanded={mdOpen}
            >
              <span>Master Data</span>
              <Ic n={mdOpen ? 'up' : 'down'} s={14} />
            </button>
            {mdOpen && (
              <div className="sub">{master.map((n) => nv(n, true))}</div>
            )}
            <div className="sep" />
            {admin && nv({ k: 'setting', l: 'Pengaturan', ic: 'gear' })}
            <button
              className="nv out"
              onClick={() => {
                setSid('');
                setPage('');
                setThemeU(null);
                setThOpen(false);
              }}
            >
              <Ic n="logout" s={17} />
              <span>Keluar</span>
            </button>
          </nav>
          </div>
        </aside>

        <div className="main">
          <header className="top">
            <button
              type="button"
              className="burger"
              aria-label="Buka menu"
              aria-controls="sidenav"
              aria-expanded={navOpen}
              onClick={() => setNavOpen((x) => !x)}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <div className="ttl">
              <b>PO Request System</b>
              <small>PT Argapura</small>
            </div>
            <div className="gs ifld">
              <span className="ico">
                <Ic n="search" s={16} />
              </span>
              <input
                value={gdraft}
                onChange={(e) => {
                  setGdraft(e.target.value);
                  if (!e.target.value) setGq('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
                placeholder="Cari nomor PO, supplier, atau item..."
                aria-label="Pencarian PO"
              />
            </div>
            <span className="sp" />
            <div className="thmw">
              <button
                className="bell"
                aria-label="Tema warna"
                title="Tema warna"
                aria-expanded={thOpen}
                onClick={() => {
                  if (!thOpen) setThPrev({ g: themeG, u: themeU });
                  setThOpen((x) => !x);
                }}
              >
                <Ic n="palette" s={18} />
              </button>
              {thOpen && (
                <>
                  <div className="thm" role="dialog" aria-label="Tema warna">
                    <b>Tema Warna</b>
                    <p className="mute small">
                      Panel tetap terbuka sampai Anda menekan Kembali.{' '}
                      {admin
                        ? 'Perubahan disimpan dan berlaku untuk seluruh sistem (semua user).'
                        : 'Perubahan hanya berlaku sementara di sesi ini. Setelah keluar atau muat ulang, tampilan kembali ke tema yang ditetapkan admin.'}
                    </p>
                    <div className="sw">
                      {THEMES.map((t) => (
                        <button
                          key={t.n}
                          type="button"
                          className={hue === t.d ? 'on' : ''}
                          title={t.n}
                          aria-label={t.n}
                          aria-pressed={hue === t.d}
                          style={{
                            background: `linear-gradient(135deg,${rotHex(
                              '#0a3a8e',
                              t.d
                            )},${rotHex('#1e7fe0', t.d)} 55%,${rotHex(
                              '#40e2ee',
                              t.d
                            )})`,
                          }}
                          onClick={() => {
                            if (admin) setThemeG(t.d);
                            else setThemeU(t.d);
                            notify(
                              admin
                                ? `Tema "${t.n}" diterapkan ke seluruh sistem.`
                                : `Tema "${t.n}" aktif untuk sesi ini saja.`
                            );
                          }}
                        />
                      ))}
                    </div>
                    <label htmlFor="hue">Geser warna kustom</label>
                    <input
                      id="hue"
                      type="range"
                      min={-180}
                      max={180}
                      step={2}
                      value={hue === GRAY ? 0 : hue}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (admin) setThemeG(v);
                        else setThemeU(v);
                      }}
                    />
                    <div className="thact">
                      <button
                        type="button"
                        className="back"
                        onClick={() => setThOpen(false)}
                      >
                        <Ic n="left" s={14} /> Kembali
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        disabled={
                          hue === (admin ? thPrev.g : thPrev.u ?? thPrev.g)
                        }
                        onClick={() => {
                          if (admin) setThemeG(thPrev.g);
                          else setThemeU(thPrev.u);
                          notify('Perubahan tema dibatalkan.');
                        }}
                      >
                        Batalkan
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <button
              className="bell"
              aria-label="Notifikasi"
              onClick={() => go(admin ? (pending ? 'users' : 'all') : 'notif')}
            >
              <Ic n="bell" s={18} />
              {bellN > 0 && <i className="rd" />}
            </button>
            <div className="me">
              <button
                className="mebtn"
                onClick={() => setUm((x) => !x)}
                aria-expanded={um}
              >
                <span className="av">{initials}</span>
                <span className="mn">
                  <b>{me.nama}</b>
                  <small>{admin ? 'Administrator' : me.dept}</small>
                </span>
                <Ic n="down" s={14} />
              </button>
              {um && (
                <>
                  <div className="umask" onClick={() => setUm(false)} />
                  <div className="umenu">
                    {!admin && (
                      <button
                        onClick={() => {
                          setUm(false);
                          setPwOpen(true);
                        }}
                      >
                        <Ic n="user" s={18} />
                        Ganti Password
                      </button>
                    )}
                    {admin && (
                      <button onClick={() => go('setting')}>
                        <Ic n="gear" s={18} />
                        Pengaturan
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setSid('');
                        setPage('');
                        setThemeU(null);
                        setThOpen(false);
                        setUm(false);
                      }}
                    >
                      <Ic n="logout" s={18} />
                      Keluar
                    </button>
                  </div>
                </>
              )}
            </div>
          </header>

          <div className="crumb">
            <button
              type="button"
              className="chome"
              aria-label="Beranda"
              onClick={() => go('')}
            >
              <Ic n="home" s={16} />
            </button>
            <Ic n="right" s={14} />
            <span>{meta.c}</span>
            {meta.c !== meta.t && (
              <>
                <Ic n="right" s={14} />
                <b>{meta.t}</b>
              </>
            )}
          </div>

          {cur !== 'dash' && (
            <div className="card hero">
              <span className="hico">
                <Ic n={meta.ic} s={22} />
              </span>
              <div>
                <h1>{meta.t}</h1>
                <p>{meta.s}</p>
              </div>
              <svg
                className="wave"
                viewBox="0 0 600 120"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="wg" x1="0" x2="1">
                    <stop offset="0" stopColor="#7fe6f2" stopOpacity="0" />
                    <stop offset=".5" stopColor="#35b6ea" stopOpacity=".55" />
                    <stop offset="1" stopColor="#0f5fc0" stopOpacity=".8" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3, 4].map((i) => (
                  <path
                    key={i}
                    d={`M0 ${100 - i * 4} C150 ${10 + i * 6} 300 ${
                      150 - i * 10
                    } 600 ${20 + i * 8}`}
                    fill="none"
                    stroke="url(#wg)"
                    strokeWidth={2 + i * 1.5}
                    opacity={0.35 + i * 0.12}
                  />
                ))}
              </svg>
            </div>
          )}
          <section key={cur} className="pg">
            {cur === 'form' && (
              <Form
                key={fk}
                me={me}
                pos={pos}
                draft={draft}
                cats={cats}
                bps={bps}
                msup={msup}
                cfg={numCfg}
                taxes={taxes}
                notify={notify}
                fixedNo={fixedNo}
                readOnly={formRO}
                onBack={
                  formRO || fixedNo
                    ? () => {
                        setDraft(null);
                        setFixedNo(null);
                        setFormRO(false);
                        setPage(formRO ? 'all' : 'riwayat');
                      }
                    : undefined
                }
                onSubmit={(p0) => {
                  if (fixedNo) {
                    // Perbaikan PO ditolak: PO yang sama diperbarui (nomor tetap),
                    // status penolakan dibersihkan, tercatat sebagai kirim ulang.
                    const p = {
                      ...p0,
                      no: fixedNo,
                      rej: undefined,
                      rejWhy: undefined,
                      resent: new Date().toISOString(),
                    };
                    setPos((l) => l.map((x) => (x.no === fixedNo ? p : x)));
                    autoSupplier(p);
                    logH(
                      fixedNo,
                      'Pengajuan diperbaiki & dikirim ulang oleh user (setelah ditolak)'
                    );
                    setDraft(null);
                    setFixedNo(null);
                    setFormRO(false);
                    setPage('riwayat');
                    setViewNo(fixedNo);
                    notify(
                      `Perbaikan terkirim: ${fixedNo}. Admin akan memprosesnya kembali.`
                    );
                    return;
                  }
                  const no = uniqueNo(p0.no, new Set(pos.map((x) => x.no)));
                  const p = no === p0.no ? p0 : { ...p0, no };
                  const sq = seqOf(p.no);
                  if (sq)
                    setNumCfg((c) =>
                      c[sq.y]?.free?.includes(sq.n)
                        ? {
                            ...c,
                            [sq.y]: {
                              ...c[sq.y],
                              free: (c[sq.y].free ?? []).filter((n) => n !== sq.n),
                            },
                          }
                        : c
                    );
                  setPos((l) => [
                    p,
                    ...l.map((x) =>
                      p.prevNo && x.no === p.prevNo ? { ...x, newNo: p.no } : x
                    ),
                  ]);
                  autoSupplier(p);
                  logH(
                    p.no,
                    p.prevNo
                      ? `Pengajuan PO baru dibuat sebagai pengganti PO reject ${p.prevNo} (${p.v.nama}, ${p.items.length} item)`
                      : `Pengajuan PO baru dibuat (${p.v.nama}, ${p.items.length} item)`
                  );
                  if (p.prevNo)
                    logH(p.prevNo, `PO reject digantikan PO baru ${p.no}`);
                  setDraft(null);
                  setPage('riwayat');
                  setViewNo(p.no);
                  notify(
                    no === p0.no
                      ? `Request terkirim: ${p.no}`
                      : `Request terkirim: ${p.no} (nomor disesuaikan agar unik)`
                  );
                }}
              />
            )}

            {cur === 'riwayat' && (
              <Card ic="fileList" title={`Riwayat Pengajuan — ${me.dept}`}>
                <div className="body">
                  {gq && (
                    <div className="info">
                      <span>
                        Filter pencarian: <b>{gq}</b>
                      </span>
                      <button
                        className="ghost"
                        onClick={() => {
                          setGq('');
                          setGdraft('');
                        }}
                      >
                        Hapus filter
                      </button>
                    </div>
                  )}
                  <PoTable
                    list={pos.filter((p) => sameDept(p.dept, me.dept) && match(p, gq))}
                    onCopy={copy}
                    onPrint={openDoc}
                    onResend={resend}
                    resendOf={(p) => p.uid === me.id}
                    lockedOf={lockedOf}
                    onEdit={editPo}
                    onNewFrom={newFromRejected}
                    aksiLabel="Keterangan"
                  />
                </div>
              </Card>
            )}

            {cur === 'approval' && (
              <Card ic="clock" title="Pengajuan Menunggu Diproses">
                <div className="body">
                  <PoTable
                    list={scope.filter(isWait)}
                    onCopy={copy}
                    onPrint={openDoc}
                  />
                </div>
              </Card>
            )}

            {cur === 'tracking' && (
              <TrackingPage
                list={scope}
                me={me}
                onPrint={openDocFromTracking}
                onSet={setTrk}
                notify={notify}
                lockedOf={lockedOf}
              />
            )}
            {cur === 'supplier' && (
              <>
                <MasterSupplierPage
                  msup={msup}
                  setMsup={setMsup}
                  canEdit={admin}
                  onUse={admin ? undefined : useMaster}
                  notify={notify}
                />
                <BPPage
                  bps={bps}
                  setBps={setBps}
                  canEdit={admin}
                  notify={notify}
                />
                <SupplierPage
                  list={scope}
                  onUse={admin ? undefined : useSupplier}
                />
              </>
            )}
            {cur === 'barang' && (
              <BarangPage list={scope} onUse={admin ? undefined : useBarang} />
            )}
            {cur === 'kategori' && (
              <KategoriPage
                cats={cats}
                setCats={setCats}
                setPos={setPos}
                list={scope}
                canEdit={admin}
                notify={notify}
              />
            )}
            {cur === 'history' && (
              <HistoryPage
                admin={admin}
                rows={
                  admin
                    ? hist
                    : hist.filter((h) => {
                        if (h.uid === me.id) return true;
                        const x = pos.find((y) => y.no === h.no);
                        return !!x && (x.uid === me.id || sameDept(x.dept, me.dept));
                      })
                }
              />
            )}
            {cur === 'notif' && (
              <NotifPage
                list={mine}
                seen={seen}
                me={me.id}
                onRead={readOne}
                onReadAll={readAll}
                onPrint={openDoc}
                onResend={resend}
                onNewFrom={newFromRejected}
                lockedOf={lockedOf}
              />
            )}
            {cur === 'setting' && (
              <>
                <SettingsPage
                  changePw={changePw}
                  me={me}
                  setUsers={setUsers}
                  brand={brand}
                  setBrand={setBrand}
                  notify={notify}
                  pos={pos}
                  numCfg={numCfg}
                  setNumCfg={setNumCfg}
                  depts={depts}
                  setDepts={setDepts}
                  setPos={setPos}
                  users={users}
                  taxes={taxes}
                  setTaxes={setTaxes}
                />
                {admin && (
                  <IntegrityCard
                    users={users}
                    pos={pos}
                    hist={hist}
                    setUsers={setUsers}
                    setPos={setPos}
                    setHist={setHist}
                    notify={notify}
                  />
                )}
              </>
            )}

            {cur === 'dash' && (
              <Dashboard
                list={scope}
                me={me}
                admin={admin}
                per={per}
                onPrint={openDoc}
                onAll={viewAll}
                onPer={setPer}
                deptList={deptNames}
                cats={cats}
              />
            )}

            {cur === 'all' && (
              <AllPage
                list={pos}
                bps={bps}
                depts={deptNames}
                init={{ dept: fDept, stat: fStat, q: gq }}
                onPrint={openDoc}
                onCopy={copy}
                onDone={markDone}
                onAllowReprint={allowReprint}
                onReject={reject}
                onPoReject={poReject}
                onReopen={reopen}
                lockedOf={lockedOf}
                onExport={exportCsv}
                onViewForm={admin ? viewForm : undefined}
              />
            )}

            {cur === 'doc' &&
              (() => {
                const all = [...pos].sort((a, b) => b.iso.localeCompare(a.iso));
                const sel = all.find((p) => p.no === viewNo) ?? all[0];
                return (
                  <Card ic="file" title="Dokumen PO">
                    <div className="body">
                      {sel ? (
                        <PoViewer
                          po={sel}
                          list={all}
                          onPick={setViewNo}
                          onBack={backFromDoc}
                          admin
                          onPrinted={markPrinted}
                          backLabel={
                            'Kembali ke ' +
                            (META[backPg]?.c ?? 'Semua Pengajuan')
                          }
                        />
                      ) : (
                        <div className="empty">Belum ada PO yang dibuat.</div>
                      )}
                    </div>
                  </Card>
                );
              })()}

            {cur === 'users' && (
              <Card ic="users" title="Verifikasi User">
                <div className="body">
                  <div className="bar">
                    <div className="ifld grow">
                      <span className="ico">
                        <Ic n="search" s={18} />
                      </span>
                      <input
                        value={uq}
                        onChange={(e) => {
                          setUq(e.target.value);
                          setUPg(1);
                        }}
                        placeholder="Cari nama / email / departemen..."
                      />
                    </div>
                  </div>
                  <div className="tbl utbl">
                    <table>
                      <thead>
                        <tr>
                          <th>Nama</th>
                          <th>Username</th>
                          <th>Email</th>
                          <th>Password</th>
                          <th>Departemen</th>
                          <th>Status</th>
                          <th>Keterangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uRows
                          .slice((uPgSafe - 1) * 15, uPgSafe * 15)
                          .map((u) => (
                            <tr key={u.id}>
                              <td>{u.nama}</td>
                              <td>{uname(u)}</td>
                              <td>{u.email}</td>
                              <td>
                                <span className="pwcell">
                                  {shownPw[u.id] ? (
                                    <>
                                      <code title="Password sementara (hanya tampil di layar ini)">
                                        {shownPw[u.id]}
                                      </code>{' '}
                                      <button
                                        type="button"
                                        className="pweye"
                                        title="Salin password"
                                        aria-label="Salin password"
                                        onClick={() => {
                                          void navigator.clipboard
                                            ?.writeText(shownPw[u.id])
                                            .then(() => notify('Password disalin.'));
                                        }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
                                      </button>
                                      <button
                                        type="button"
                                        className="pweye"
                                        title="Sembunyikan password"
                                        aria-label="Sembunyikan password"
                                        onClick={() =>
                                          setShownPw((m) => {
                                            const { [u.id]: _x, ...r } = m;
                                            return r;
                                          })
                                        }
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.6 10.6 0 0 1 12 19C5.6 19 2 12 2 12a18.5 18.5 0 0 1 5-5.9M9.9 5.2A10 10 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/></svg>
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <code title="Password disimpan terenkripsi (hash) dan tidak bisa dilihat.">
                                        ••••••••
                                      </code>{' '}
                                      <button
                                        type="button"
                                        className="pwreset"
                                        disabled={u.id === me.id}
                                        title="Reset password dan kirim password baru ke email user"
                                        onClick={() => void resetPw(u)}
                                      >
                                        Reset
                                      </button>
                                    </>
                                  )}
                                </span>
                              </td>
                              <td>{u.dept}</td>
                              <td>
                                <span className={'tag s-' + u.status}>
                                  {u.status}
                                </span>
                              </td>
                              <td>
                                <select
                                  className="actsel"
                                  value=""
                                  disabled={u.id === me.id}
                                  title={
                                    u.id === me.id
                                      ? 'Akun sendiri tidak dapat diubah'
                                      : 'Pilih tindakan'
                                  }
                                  aria-label={'Tindakan untuk ' + u.nama}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === 'approve')
                                      setUserStatus(u.id, 'approved');
                                    else if (v === 'reject')
                                      setUserStatus(u.id, 'rejected');
                                    else if (v === 'reset') resetPw(u);
                                    else if (v === 'role-user')
                                      setUserRole(u, 'user');
                                    else if (v === 'role-admin')
                                      setUserRole(u, 'admin');
                                  }}
                                >
                                  <option value="">Pilih tindakan…</option>
                                  <optgroup label="Status Akun &amp; Password">
                                    {u.status !== 'approved' && (
                                      <option value="approve">Approve</option>
                                    )}
                                    {u.status !== 'rejected' && (
                                      <option value="reject">
                                        {u.status === 'approved'
                                          ? 'Deactivate'
                                          : 'Reject'}
                                      </option>
                                    )}
                                    <option value="reset">
                                      Reset Password
                                    </option>
                                  </optgroup>
                                  <optgroup label="Hak Akses (Rule)">
                                    <option
                                      value="role-user"
                                      disabled={u.role === 'user'}
                                    >
                                      {u.role === 'user'
                                        ? '✓ User (saat ini)'
                                        : 'Jadikan User'}
                                    </option>
                                    <option
                                      value="role-admin"
                                      disabled={u.role === 'admin'}
                                    >
                                      {u.role === 'admin'
                                        ? '✓ Admin (saat ini)'
                                        : 'Jadikan Admin'}
                                    </option>
                                  </optgroup>
                                </select>
                              </td>
                            </tr>
                          ))}
                        {!users.some((u) => u.id !== ADMIN.id) && (
                          <tr>
                            <td colSpan={7} className="empty">
                              Belum ada user terdaftar.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <Pager page={uPgSafe} pages={uPages} onPage={setUPg} />
                  </div>
                </div>
              </Card>
            )}
          </section>
        </div>
      </div>
      {!admin && viewPo && (
        <div
          className="modal"
          onClick={(e) => e.target === e.currentTarget && setViewNo('')}
        >
          <PoViewer
            po={viewPo}
            onClose={() => setViewNo('')}
            canPrint={viewPo.status === 'Done'}
            onPrinted={markPrinted}
          />
        </div>
      )}
      {pwOpen && (
        <PwModal
          onSubmit={changePw}
          onClose={() => setPwOpen(false)}
          notify={notify}
        />
      )}
      {toast && <div id="toast">{toast}</div>}
    </>
  );
}

/** Kekuatan password mengikuti acuan gambar: Lemah <6 karakter, Sedang 6-8 karakter,
 *  Kuat >8 karakter + huruf & angka, Sangat Kuat >8 karakter + huruf besar, huruf kecil, angka & simbol. */
/** Daftar level kekuatan password (dipakai meter & legenda). */
const PWLEVELS = [
  { lvl: 'Lemah', desc: 'Kurang dari 6 karakter', color: '#f87171' },
  { lvl: 'Sedang', desc: '6–8 karakter (huruf atau angka)', color: '#fbbf24' },
  { lvl: 'Kuat', desc: 'Lebih dari 8 karakter (dengan kombinasi huruf dan angka)', color: '#2dd4bf' },
  { lvl: 'Sangat Kuat', desc: 'Lebih dari 8 karakter (dengan kombinasi huruf besar, huruf kecil, angka dan simbol (contoh: @ $ % & *))', color: '#34d399' },
];

function pwStrength(n: string): { lvl: string; desc: string; color: string; filled: number } {
  const hasUpper = /[A-Z]/.test(n);
  const hasLower = /[a-z]/.test(n);
  const hasDigit = /\d/.test(n);
  const hasSym = /[^A-Za-z0-9]/.test(n);
  if (!n) return { lvl: '', desc: '', color: '', filled: 0 };
  if (n.length < 6) return { ...PWLEVELS[0], filled: 1 };
  if (n.length > 8 && hasUpper && hasLower && hasDigit && hasSym)
    return { ...PWLEVELS[3], filled: 4 };
  if (n.length > 8 && (hasUpper || hasLower) && hasDigit)
    return { ...PWLEVELS[2], filled: 3 };
  return { ...PWLEVELS[1], filled: 2 };
}

/** Meter kekuatan password + keterangan level (dipakai modal & kartu pengaturan user). */
function PwMeter({ n, track }: { n: string; track?: string }) {
  const st = pwStrength(n);
  if (!n) return null;
  return (
    <>
      <div className="pwstr">
        <span className="bars">
          {[1, 2, 3, 4].map((k) => (
            <i
              key={k}
              style={{
                background: k <= st.filled ? st.color : track || 'rgba(255,255,255,.22)',
                boxShadow: k <= st.filled ? `0 0 8px ${st.color}` : undefined,
              }}
            />
          ))}
        </span>
        <small style={{ color: st.color }}>{st.lvl}</small>
      </div>
      <div className="pwdesc">{st.desc}</div>
      <div className="pwlegend">
        {PWLEVELS.map((lv) => (
          <div
            key={lv.lvl}
            style={lv.lvl === st.lvl ? { boxShadow: `inset 0 0 0 1.5px ${lv.color}` } : undefined}
          >
            <b style={{ color: lv.color }}>{lv.lvl}</b>
            <small>{lv.desc}</small>
          </div>
        ))}
      </div>
    </>
  );
}

/** Modal ganti password (menu kanan atas). */
function PwModal({
  onSubmit,
  onClose,
  notify,
}: {
  onSubmit: (o: string, n: string) => Promise<string>;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const [o, setO] = useState('');
  const [n, setN] = useState('');
  const [c, setC] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!o || !n || !c) return setErr('Lengkapi semua isian.');
    if (n !== c) return setErr('Konfirmasi password baru tidak sama.');
    const e = await onSubmit(o, n);
    if (e) return setErr(e);
    notify('Password berhasil diganti.');
    onClose();
  };
  const t = show ? 'text' : 'password';
  return (
    <div
      className="modal"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="pwbox lux"
        role="dialog"
        aria-modal="true"
        aria-label="Ganti Password"
      >
        <span className="sheen" aria-hidden="true" />
        <svg
          className="pworn"
          viewBox="0 0 400 520"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="pwg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#7fe3ff" stopOpacity="0" />
              <stop offset=".5" stopColor="#bfeaff" stopOpacity=".55" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M-20 470 C 80 410, 180 520, 300 450 S 400 420, 440 450"
            fill="none"
            stroke="url(#pwg)"
            strokeWidth="1.6"
          />
          <path
            d="M-20 495 C 100 440, 200 540, 320 470 S 410 450, 440 475"
            fill="none"
            stroke="url(#pwg)"
            strokeWidth="1"
            opacity=".7"
          />
          <circle
            cx="352"
            cy="58"
            r="64"
            fill="none"
            stroke="#bfeaff"
            strokeOpacity=".22"
          />
          <circle
            cx="352"
            cy="58"
            r="42"
            fill="none"
            stroke="#bfeaff"
            strokeOpacity=".16"
          />
        </svg>
        <div className="pwhead">
          <span className="pwlock">
            <Ic n="lock" s={26} />
          </span>
          <h3>Ganti Password</h3>
          <p>Amankan akun Anda dengan password baru.</p>
          <div className="pwdiv">
            <i />
            <em />
            <i />
          </div>
        </div>
        <Field label="Password lama">
          <input
            type={t}
            value={o}
            onChange={(e) => {
              setO(e.target.value);
              setErr('');
            }}
            autoFocus
          />
        </Field>
        <Field label="Password baru (min. 6 karakter)">
          <input
            type={t}
            value={n}
            onChange={(e) => {
              setN(e.target.value);
              setErr('');
            }}
          />
          <PwMeter n={n} />
        </Field>
        <Field label="Ulangi password baru">
          <input
            type={t}
            value={c}
            onChange={(e) => {
              setC(e.target.value);
              setErr('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </Field>
        <label className="pwshow">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
          />{' '}
          Tampilkan password
        </label>
        {err && <div className="pwerr">{err}</div>}
        <div className="acts">
          <button className="pri" onClick={save}>
            Simpan
          </button>
          <button className="pwcancel" onClick={onClose}>
            Batal
          </button>
        </div>
        <div className="pwfoot">
          <Ic n="lock" s={12} /> Dilindungi &middot; PT Argapura PO Request
          System
        </div>
      </div>
    </div>
  );
}

/** Pengaturan sistem: pemeriksaan & perbaikan keunikan data (akun, ID, nomor PO, catatan riwayat) agar tidak bentrok saat user makin banyak. */
function IntegrityCard({
  users,
  pos,
  hist,
  setUsers,
  setPos,
  setHist,
  notify,
}: {
  users: User[];
  pos: PO[];
  hist: Hist[];
  setUsers: (f: (u: User[]) => User[]) => void;
  setPos: (f: (p: PO[]) => PO[]) => void;
  setHist: (f: (h: Hist[]) => Hist[]) => void;
  notify: (m: string) => void;
}) {
  const dups = (a: string[]) => {
    const m = new Map<string, number>();
    a.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
    return [...m.values()].filter((v) => v > 1).reduce((t, v) => t + v - 1, 0);
  };
  const checks = [
    {
      l: 'Email akun unik (tanpa beda huruf besar/kecil)',
      n: dups(users.map((u) => u.email.trim().toLowerCase())),
    },
    { l: 'ID akun unik', n: dups(users.map((u) => u.id)) },
    { l: 'Nomor PO unik', n: dups(pos.map((x) => x.no)) },
    { l: 'ID catatan Change History unik', n: dups(hist.map((h) => h.id)) },
  ];
  const bad = checks.reduce((t, c) => t + c.n, 0);
  const fix = () => {
    setUsers((l) => {
      const seenE = new Set<string>(),
        seenI = new Set<string>();
      const sorted = [...l].sort(
        (a, b) =>
          Number(b.status === 'approved') - Number(a.status === 'approved')
      ); // akun approved diprioritaskan
      const out = new Map<string, User>();
      sorted.forEach((u, i) => {
        let email = u.email.trim().toLowerCase();
        let id = u.id;
        let status = u.status;
        if (seenE.has(email)) {
          const [a, b] = email.split('@');
          email = `${a}+dup${i}@${b ?? 'local'}`;
          status = 'rejected';
        }
        if (seenI.has(id)) id = newId('u-');
        seenE.add(email);
        seenI.add(id);
        out.set(l.indexOf(u) + '', { ...u, email, id, status });
      });
      return l.map((_, i) => out.get(i + '')!);
    });
    setPos((l) => {
      const taken = new Set<string>();
      return l.map((x) => {
        const no = uniqueNo(x.no, taken);
        taken.add(no);
        return no === x.no ? x : { ...x, no };
      });
    });
    setHist((l) => {
      const seen = new Set<string>();
      return l.map((h) => {
        const id = seen.has(h.id) ? newId('h-') : h.id;
        seen.add(id);
        return id === h.id ? h : { ...h, id };
      });
    });
    notify('Data diperiksa dan duplikat diperbaiki.');
  };
  return (
    <Card ic="info" title="Keunikan Data & Anti-Bentrok">
      <div className="body">
        <p className="mute small" style={{ marginTop: 0 }}>
          Sistem memakai ID acak (UUID) untuk akun dan catatan, membandingkan
          email tanpa membedakan huruf besar/kecil, menyesuaikan nomor PO
          otomatis bila bentrok saat submit, serta menyinkronkan data antar tab
          browser.
        </p>
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Pemeriksaan</th>
                <th>Hasil</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.l}>
                  <td>{c.l}</td>
                  <td>
                    <span className={'tag ' + (c.n ? 's-rejected' : 's-Done')}>
                      {c.n ? `${c.n} duplikat` : 'Aman'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acts" style={{ marginTop: 10 }}>
          <button className="pri" disabled={!bad} onClick={fix}>
            Perbaiki otomatis
          </button>
          {!bad && (
            <span className="mute small">Tidak ada duplikat ditemukan.</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Data contoh Change History untuk admin (dibuat dari user & PO contoh yang ada). */
function makeDemoHist(pos: PO[], users: User[]): Hist[] {
  const now = Date.now();
  const out: Hist[] = [];
  let n = 0;
  const push = (
    iso: string,
    u: { id: string; nama: string; dept: string },
    no: string,
    what: string
  ) => {
    if (new Date(iso).getTime() <= now)
      out.push({
        id: `seed-${++n}-${hash32(iso + what + no).toString(36)}`,
        iso,
        uid: u.id,
        by: u.nama,
        dept: u.dept,
        no,
        what,
      });
  };
  const at = (day: string, key: string) => {
    const [y, m, d] = dayOf(day).split('-').map(Number);
    const h = hash32(key);
    return new Date(
      y,
      m - 1,
      d,
      8 + (h % 9),
      (h >>> 4) % 60,
      (h >>> 9) % 60
    ).toISOString();
  };
  const demoU = users.filter((u) => u.id.startsWith('demo-'));
  pos
    .filter((x) => x.uid.startsWith('demo-'))
    .forEach((p) => {
      const cr = users.find((u) => u.id === p.uid) ?? ADMIN;
      push(
        p.iso,
        cr,
        p.no,
        `Pengajuan PO baru dibuat (${p.v.nama}, ${p.items.length} item)`
      );
      if (p.rej) push(p.rej, ADMIN, p.no, 'Pengajuan ditolak (Rejected)');
      TSTEPS.forEach((st) => {
        if (st.k === 'made') return;
        const d = p.trk?.[st.k as TKey];
        if (!d) return;
        const actor =
          st.k === 'supp'
            ? cr
            : st.k === 'recv'
            ? hash32(p.no + 'r') % 3 === 0
              ? ADMIN
              : cr
            : ADMIN;
        const t = at(d, p.no + st.k);
        if (hash32(p.no + st.k) % 11 === 0) {
          const [y, m, dd] = dayOf(d).split('-').map(Number);
          const prev = ymd(new Date(y, m - 1, dd - 1));
          push(
            at(prev, p.no + st.k + 'a'),
            actor,
            p.no,
            `${st.l}: tanggal diisi ${fmtD(prev)}`
          );
          push(
            t,
            actor,
            p.no,
            `${st.l}: tanggal diubah ${fmtD(prev)} → ${fmtD(d)}`
          );
        } else push(t, actor, p.no, `${st.l}: tanggal diisi ${fmtD(d)}`);
        if (st.k === 'appr')
          push(
            new Date(new Date(t).getTime() + 90000).toISOString(),
            ADMIN,
            p.no,
            'Status PO ditandai Done (PO di-approve)'
          );
        if (st.k === 'supp' && hash32(p.no + 'lk') % 3 === 0)
          push(
            new Date(new Date(t).getTime() + 120000).toISOString(),
            cr,
            p.no,
            'Link bukti pengiriman ke supplier diisi'
          );
      });
    });
  demoU.forEach((u, i) => {
    const base = new Date(now - (200 - i * 6) * 86400000);
    if (u.status === 'approved')
      push(
        new Date(
          base.getFullYear(),
          base.getMonth(),
          base.getDate(),
          9 + (i % 6),
          (i * 7) % 60,
          12
        ).toISOString(),
        ADMIN,
        '-',
        `Approve anggota baru: ${u.nama} (${u.email})`
      );
    if (u.status === 'approved' && i % 4 === 1)
      push(
        new Date(base.getTime() + 20 * 86400000 + i * 3600000).toISOString(),
        u,
        '-',
        'Ganti password akun sendiri'
      );
    if (u.status === 'approved' && i % 7 === 3)
      push(
        new Date(base.getTime() + 41 * 86400000 + i * 3600000).toISOString(),
        ADMIN,
        '-',
        `Reset password akun ${u.nama} (${u.email})`
      );
  });
  return out.sort((a, b) => b.iso.localeCompare(a.iso));
}

/* ================= TEMA WARNA: seluruh warna biru/aqua pada CSS diputar huenya (status hijau/merah/kuning tidak ikut berubah) ================= */
const DARKER = new Set([-170, 140, 50]); // tema Emas (coklat), Merah Ruby, Ungu Royal: dibuat lebih gelap
const DARK_K = 0.2; // tema Emas/Ruby/Ungu: dasar 20%
const DARK_X = 0.15; // tambahan gelap 15% untuk semua tema warna (selain Biru Samudra bawaan & Hitam Putih). Warna sangat terang (latar/kartu) dikecualikan agar halaman tetap terbaca
const darkK = (d: number) => 1 - (1 - (DARKER.has(d) ? DARK_K : 0)) * (1 - DARK_X);
const GRAY = 999; // kode khusus tema monokrom "Klasik Hitam Putih" (bukan sudut hue)
const THEMES: { n: string; d: number }[] = [
  { n: 'Biru Samudra', d: 0 },
  { n: 'Teal', d: -28 },
  { n: 'Klasik Hitam Putih', d: GRAY },
  { n: 'Emas', d: -170 },
  { n: 'Merah Ruby', d: 140 },
  { n: 'Magenta', d: 100 },
  { n: 'Ungu Royal', d: 50 },
  { n: 'Indigo', d: 25 },
];
const toHsl = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    l = (mx + mn) / 2,
    dd = mx - mn;
  if (!dd) return [0, 0, l];
  const s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const h =
    mx === r
      ? (g - b) / dd + (g < b ? 6 : 0)
      : mx === g
      ? (b - r) / dd + 2
      : (r - g) / dd + 4;
  return [h * 60, s, l];
};
const fromHsl = (h: number, s: number, l: number): [number, number, number] => {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    return Math.round(
      255 *
        (t < 1 / 6
          ? p + (q - p) * 6 * t
          : t < 1 / 2
          ? q
          : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p)
    );
  };
  return [f(h / 360 + 1 / 3), f(h / 360), f(h / 360 - 1 / 3)];
};
/** Putar hue hanya untuk warna biru/aqua (165°–255°) yang cukup berwarna. */
const rotRGB = (
  r: number,
  g: number,
  b: number,
  d: number
): [number, number, number] => {
  if (!d) return [r, g, b];
  const [h, s, l] = toHsl(r, g, b);
  if (s < 0.1 || h < 165 || h > 255) return [r, g, b];
  if (d === GRAY) {
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    return [y, y, y];
  } // biru/aqua -> abu-abu (setara kecerahan)
  const f = l <= 0.6 ? 1 : l >= 0.92 ? 0 : (0.92 - l) / 0.32;
  const l2 = l * (1 - darkK(d) * f); // gelapkan nada sedang/gelap (sidebar, tombol, header), latar terang tetap
  return fromHsl((((h + d) % 360) + 360) % 360, s, l2);
};
const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const rotHex = (hx: string, d: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hx);
  if (!m) return hx;
  const [r, g, b] = rotRGB(
    parseInt(m[1].slice(0, 2), 16),
    parseInt(m[1].slice(2, 4), 16),
    parseInt(m[1].slice(4, 6), 16),
    d
  );
  return '#' + hex2(r) + hex2(g) + hex2(b);
};
const themeCache = new Map<number, string>();
function themed(src: string, d: number): string {
  const hit = themeCache.get(d);
  if (hit) return hit;
  let out = src;
  if (d) {
    out = out
      .replace(
        /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g,
        (_m, h: string) => {
          const f =
            h.length === 3
              ? h
                  .split('')
                  .map((c) => c + c)
                  .join('')
              : h;
          return rotHex('#' + f, d);
        }
      )
      .replace(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\.?\d*\.?\d+)\s*)?\)/g,
        (_m, r: string, g: string, b: string, a?: string) => {
          const [x, y, z] = rotRGB(+r, +g, +b, d);
          return a === undefined
            ? `rgb(${x},${y},${z})`
            : `rgba(${x},${y},${z},${a})`;
        }
      )
      .replace(
        /rgba\((\d+),(\d+),(\d+),(calc\([^)]*\([^)]*\)\))\)/g,
        (_m, r: string, g: string, b: string, a: string) => {
          const [x, y, z] = rotRGB(+r, +g, +b, d);
          return `rgba(${x},${y},${z},${a})`;
        }
      );
  }
  out +=
    d === GRAY
      ? `\n:root{--hd:0deg}\n.waves,.wave,.trend,.cb i,.kpi:first-child .kic,.lgd i,.lg2 i,.sidefx{filter:grayscale(1)}\n`
      : `\n:root{--hd:${d}deg}\n.waves,.wave,.trend,.cb i,.kpi:first-child .kic,.lgd i,.lg2 i{filter:hue-rotate(var(--hd))${
          DARKER.has(d) ? ' brightness(.8)' : ''
        }}\n`;
  themeCache.set(d, out);
  return out;
}

/* ================= STYLE (tema aqua-biru, kaca) ================= */
const css = `
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=Poppins:wght@400;500;600;700&display=swap");
:root{color-scheme:light;--bg:#e4f3fb;--card:#fff;--ink:#12284a;--mute:#5b6f8c;--line:#d3e2f2;--brand:#0f5fc0;--brand2:#1fa4de;--aqua:#2dd4d8;--soft:#e8f3fd}
*{box-sizing:border-box}
html,body,#root{margin:0;padding:0;width:100%;max-width:none;display:block;text-align:left}
#root{background:transparent}
body{color:var(--ink);font:14px/1.5 Inter,"Segoe UI",system-ui,Roboto,Arial,sans-serif;background:radial-gradient(900px 500px at 85% 0%,rgba(80,225,235,.35),transparent 60%),linear-gradient(135deg,#eaf8fd 0%,#d2e6fb 55%,#c4ecf4 100%) fixed;min-height:100vh}
.ic{flex:none;display:block}
h1,h2{font-family:inherit}
/* ---- shell: sidebar + konten ---- */
.shell{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;overflow-y:auto;color:#fff;padding:16px 10px 16px;display:flex;flex-direction:column;border-radius:0 26px 26px 0;
  background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.8),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(80,170,255,.35),transparent 60%),linear-gradient(180deg,#0a3a8e 0%,#0b5fba 50%,#1295d6 100%);
  box-shadow:8px 0 32px rgba(10,60,140,.28)}
.brand{text-align:center;padding:2px 4px 10px}
.brand img{width:auto;max-width:100%;height:auto;max-height:64px;object-fit:contain}
.logoph{display:inline-flex;justify-content:center;background:transparent;border-radius:10px;padding:0;box-shadow:none;max-width:100%}
.brand .logoph img{max-width:185px;max-height:46px}
.brand b{display:block;margin-top:7px;font-weight:600;font-size:11.5px;letter-spacing:.5px}
.navlist{display:flex;flex-direction:column;gap:3px;margin-top:4px}
.nv{display:flex;align-items:center;gap:9px;white-space:nowrap;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:#fff;padding:7px 10px;border-radius:10px;font-size:12.5px;font-weight:500}
.nv:hover{background:rgba(255,255,255,.13)}
.nv.on{background:linear-gradient(90deg,#17a9ee,#40e2ee);border-color:rgba(255,255,255,.75);font-weight:600;box-shadow:0 0 20px rgba(90,225,255,.6),inset 0 1px 0 rgba(255,255,255,.65)}
.nv .bd{margin-left:auto;background:#ff4d5e;color:#fff;border-radius:999px;min-width:18px;height:18px;display:grid;place-items:center;font-size:10.5px;font-weight:700;padding:0 5px;font-style:normal}
.nv.grp{justify-content:space-between;padding:4px 10px;font-weight:600;font-size:12px}
.sub .nv{padding:6px 10px 6px 12px;font-size:12px}
.nv.out{margin-top:2px}.nv.out:hover{background:rgba(255,77,94,.28)}
/* ---- Sidebar: interaksi Hover (slide + glow) · Active (pill meluncur) · Transition 250ms ---- */
.navlist{position:relative}
.nv{position:relative;z-index:1;transition:background .25s ease,border-color .25s ease,box-shadow .25s ease,color .25s ease}
.nv>*:not(.bd){transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.nv:hover>*:not(.bd),.nv:focus-visible>*:not(.bd){transform:translateX(3px)}
.nv:hover:not(.out){background:linear-gradient(90deg,rgba(150,215,255,.42),rgba(190,240,255,.14));border-color:rgba(200,240,255,.55);box-shadow:0 0 14px rgba(120,210,255,.45),inset 0 1px 0 rgba(255,255,255,.35)}
.nv.out:hover{box-shadow:0 0 14px rgba(255,100,120,.4)}
.nv:focus-visible{outline:2px solid rgba(255,255,255,.9);outline-offset:1px}
.navpill{position:absolute;left:0;right:0;top:0;z-index:0;pointer-events:none;border-radius:10px;border:1px solid rgba(255,255,255,.8);
  background:linear-gradient(90deg,#17a9ee,#40e2ee);box-shadow:0 0 20px rgba(90,225,255,.6),inset 0 1px 0 rgba(255,255,255,.65)}
.navpill.go{transition:transform .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1)}
@media(prefers-reduced-motion:reduce){.nv,.nv>*:not(.bd),.navpill.go{transition:none}}
.sep{height:1px;background:rgba(255,255,255,.3);margin:7px 6px}
.main{padding:14px 20px 28px;min-width:0}
section{width:100%;min-width:0}
/* ---- topbar ---- */
.top{position:relative;z-index:30;display:flex;align-items:center;gap:10px;padding:6px 14px;border-radius:16px;border:1px solid #fff;background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(214,240,255,.7));-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 8px 28px rgba(40,100,180,.16)}
.ttl b{display:block;font-size:15px;line-height:1.15;color:#0d2a57}.ttl small{color:var(--mute);font-size:11px}
.gs{flex:1;max-width:320px;margin-left:12px}
.top .gs input{border-radius:10px;background:rgba(255,255,255,.85);height:32px;min-height:32px;padding:3px 10px 3px 32px;font-size:12px}
.top .gs .ico{left:10px;top:8px}
.sp{flex:1}
.bell{position:relative;border:0;background:transparent;padding:4px;color:#12315f}
.bell .rd{position:absolute;top:2px;right:3px;width:8px;height:8px;border-radius:50%;background:#ff4d5e;border:1.5px solid #fff}
.me{position:relative;border-left:1px solid var(--line);padding-left:10px}
.mebtn{display:flex;align-items:center;gap:8px;border:0;background:transparent;padding:2px;text-align:left}
.av{width:30px;height:30px;border-radius:50%;background:#12315f;color:#fff;display:grid;place-items:center;font-weight:700;font-size:11.5px;flex:none}
.mn b{display:block;font-size:12.5px;line-height:1.2;color:#0d2a57}.mn small{color:var(--mute);font-size:10.5px}
.umask{position:fixed;inset:0;z-index:20}
.umenu{position:absolute;right:0;top:42px;z-index:21;min-width:160px;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 30px rgba(20,60,120,.22);padding:6px;display:flex;flex-direction:column}
.umenu button{display:flex;align-items:center;gap:8px;border:0;background:transparent;text-align:left;font-size:13px;padding:7px 10px;border-radius:10px}.umenu button:hover{background:var(--soft)}
.crumb{display:flex;align-items:center;gap:8px;margin:10px 6px 8px;color:#27487c;font-size:12.5px}.crumb b{color:#0d2a57}
.chome{border:0;background:transparent;padding:0;color:#27487c;display:grid;place-items:center}
/* ---- hero ---- */
.hero{position:relative;display:flex;align-items:center;gap:12px;padding:10px 16px;min-height:60px;overflow:hidden;background:linear-gradient(120deg,rgba(255,255,255,.92),rgba(206,236,252,.8))}
.hero>div{position:relative;z-index:1}
.hico{position:relative;z-index:1;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#1558b8;background:linear-gradient(145deg,#f4faff,#c9e3fb);border:1px solid #fff;box-shadow:0 8px 20px rgba(40,100,180,.2);flex:none}
.hero h1{margin:0;font-size:20px;line-height:1.15;color:#0d2a57}.hero p{margin:1px 0 0;color:#40587f;font-size:12.5px}
.wave{position:absolute;right:0;top:0;width:55%;height:100%;pointer-events:none}
/* ---- kartu ---- */
.card{background:rgba(255,255,255,.8);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid #fff;border-radius:20px;margin-bottom:18px;overflow:hidden;box-shadow:0 10px 30px rgba(40,100,180,.13)}
.card>h2{position:relative;display:flex;align-items:center;gap:12px;margin:0;padding:0 22px;height:54px;color:#fff;font-size:17.5px;font-weight:700;background:linear-gradient(100deg,#0b56b0 0%,#1596d6 58%,#40dbe0 100%)}
.card>h2::after{content:"";position:absolute;left:0;right:0;top:0;height:50%;background:linear-gradient(180deg,rgba(255,255,255,.32),rgba(255,255,255,0));pointer-events:none}
.body{padding:18px 20px}.pad{padding:16px}
.mute{color:var(--mute)}.small{font-size:12.5px}
.two{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:18px;align-items:start}
.two2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
@media(max-width:1100px){.two,.two2{grid-template-columns:1fr}}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 20px}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px 20px}
.gi{display:grid;grid-template-columns:1fr 1fr;gap:0 22px;align-items:start}.gi .col{display:flex;flex-direction:column}
@media(max-width:700px){.grid,.gi{grid-template-columns:1fr}}
/* ---- input ---- */
label{display:block;font-weight:600;margin-bottom:6px;color:#14305c}label i{color:#d33;font-style:normal}
input,select,textarea{width:100%;padding:12px 14px;min-height:46px;border:1px solid #cddff0;border-radius:12px;background:#fff;color:var(--ink);font:inherit}
textarea{resize:none;field-sizing:content}
input::placeholder,textarea::placeholder{color:#8a9bb5}
input:focus,select:focus,textarea:focus,button:focus-visible{outline:2px solid var(--brand2);outline-offset:1px}
input[readonly]{background:#eef3fa}
.ifld{position:relative}.ifld .ico{position:absolute;left:14px;top:13px;color:#5d7396;pointer-events:none;display:flex}
.ifld input,.ifld textarea,.ifld select{padding-left:44px}
.ifld.cmb input{padding-right:44px}.ifld .arr{position:absolute;right:6px;top:5px;border:0;background:transparent;padding:8px;color:#4a6590}
.ifld.grow{flex:1;min-width:220px}
.fld{margin-bottom:14px}
.card .gi .fld{margin-bottom:16px}
/* ---- tabel & tombol ---- */
.tbl{overflow-x:auto}table{width:100%;border-collapse:collapse}
th,td{padding:8px 10px;border:1px solid var(--line);text-align:left;vertical-align:middle}th{background:var(--soft);font-size:12.5px}
.tbl tbody tr:nth-child(even) td{background:rgba(30,125,220,.07)}
.tbl tbody tr:nth-child(even) td.detail{background:#f9fbfe}
td input,td select{min-width:80px}.num{text-align:right;white-space:nowrap}

button{font:inherit;cursor:pointer;border-radius:10px;border:1px solid var(--line);background:#fff;color:var(--ink);padding:9px 16px}
.pri{background:linear-gradient(135deg,#1e7fe0,#0f5fc0);color:#fff;border-color:#0f5fc0;font-weight:600;display:inline-flex;align-items:center;gap:6px}
.ghost{color:var(--brand);border-color:var(--brand2);padding:4px 10px;font-size:12.5px;background:#fff}
/* ---- Ganti password, tampil password (admin) ---- */
.pwbox{width:100%;max-width:400px;margin-top:8vh;align-self:flex-start;padding:22px 22px 18px;border-radius:18px;background:linear-gradient(135deg,rgba(255,255,255,.92),rgba(214,238,255,.9));border:1px solid rgba(255,255,255,.9);box-shadow:0 18px 50px rgba(5,30,90,.4)}
.pwbox h3{margin:0 0 12px;color:#0a1d3d}
.pwbox .acts{margin-top:12px}
.pwshow{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mute);margin:2px 0 8px}.pwshow input{width:auto;min-width:0}
.pwcell{display:inline-flex;align-items:center;gap:6px}.pwcell code{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:rgba(10,60,140,.08);padding:2px 8px;border-radius:8px;min-width:70px}
.pweye{padding:2px 7px;font-size:14px;line-height:1.2}
/* ---- Daftar Barang: drill-down ---- */
.rowlink{cursor:pointer;transition:background .2s}
.rowlink:hover td,.rowlink:focus-visible td{background:rgba(70,170,255,.16)!important}
.rowlink:focus-visible{outline:2px solid var(--brand2);outline-offset:-2px}
.drlnk{display:inline-flex;align-items:center;gap:3px;font-weight:700;color:var(--brand);transition:transform .2s}
.rowlink:hover .drlnk{transform:translateX(3px)}
.drill .drhead{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.drill .back{display:inline-flex;align-items:center;gap:4px;font-weight:600}
.drill .drttl{flex:1;min-width:160px;display:flex;flex-direction:column}
.drill .drttl b{font-size:18px;color:#0a1d3d}.drill .drttl small{color:var(--mute);font-size:12.5px}
.drill .drstat{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}
.drill .drstat>div{padding:10px 14px;border-radius:12px;border:1px solid rgba(120,190,255,.5);background:linear-gradient(135deg,rgba(255,255,255,.7),rgba(190,230,255,.45))}
.drill .drstat small{display:block;color:var(--mute);font-size:11.5px;margin-bottom:2px}.drill .drstat b{font-size:15px;color:#0a1d3d}
.drill tr.cur td{background:rgba(45,212,216,.2)!important;font-weight:600}
.tnew2{margin-left:8px;padding:1px 8px;border-radius:99px;font-size:10.5px;font-weight:600;color:#fff;background:linear-gradient(135deg,#1e7fe0,#2dd4d8)}
.wide{width:100%;margin-top:6px}
.actions{display:flex;gap:10px;justify-content:flex-end;padding-bottom:16px}.actions .l{margin-right:auto}
.acts{display:flex;gap:6px;flex-wrap:wrap}
.acts.sm{flex-wrap:nowrap;align-items:center}
.acts.sm button{padding:1px 12px;font-size:12.5px;line-height:1.45;font-weight:600;border-radius:12px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;box-shadow:none}
.info{display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#e3f1fd,#d6ecfb);border:1px solid #cde3f6;border-radius:14px;padding:12px 14px;color:#2d4a74;margin-bottom:14px}
.info>span{flex:1}.info .ic{color:#1569c7}
.tag{background:var(--soft);color:var(--brand);border-radius:12px;padding:2px 12px;font-size:12.5px;font-style:normal;font-weight:600}
.s-Done,.s-approved{background:#e3f4ea;color:#157347}.s-rejected{background:#fde8e8;color:#b42318}.s-pending,.s-Open{background:#fff3d6;color:#8a5b00}
/* ---- Data PO ---- */
.kvi>div{display:flex;align-items:center;gap:8px;padding:9px 2px}
.kvi>div>span{display:flex;align-items:center;gap:10px;color:#4a5f80;width:134px;flex:none;white-space:nowrap}.kvi>div>span .ic{color:#486692}
.kvi b{font-weight:600;color:#10244a;flex:1;display:flex;align-items:center;gap:8px;white-space:nowrap;min-width:0}.kvi b .tag{margin-left:auto}
.sum{margin-top:10px;border-top:1px solid var(--line)}
.sum>div{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid var(--line);color:#4a5f80}
.sum>div>span:first-child{display:flex;align-items:center;gap:10px}
.sum .gt{margin-top:10px;border:0;border-radius:14px;padding:12px 14px;background:linear-gradient(135deg,#d9edfc,#c9e6fb);color:#0f5fc0;font-weight:700;font-size:18px}
.sum .gt span:last-child{font-size:25px}
.fold .fhead{display:flex;align-items:center;gap:12px;width:100%;border:0;border-radius:0;background:transparent;padding:16px 20px;color:#14305c;font-size:15px}
.fold .fhead .sp{flex:1}
.stat{padding:18px;margin:0}.stat span{color:var(--mute);display:block}.stat b{font-size:25px;color:var(--brand)}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:18px;margin-bottom:18px}
.empty{color:var(--mute);padding:14px;text-align:center}
.detail{background:#f9fbfe;font-size:13px}.detail ul{margin:6px 0;padding-left:18px}
.bar{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center}.bar>input{flex:1;min-width:200px}.bar>select{width:200px}
.prev.side{background:linear-gradient(180deg,#0a3a8e,#1295d6);padding:12px}.prev.side svg,.prev.side img{max-width:100%;max-height:64px;height:auto}
/* ---- grafik, tracking, notifikasi ---- */
.bars{display:flex;gap:10px;align-items:flex-end;height:220px}
.bcol{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;min-width:0}
.bcol .bb{flex:1;width:70%;display:flex;align-items:flex-end;background:#eef4fb;border-radius:8px;overflow:hidden}
.bcol .bb i{display:block;width:100%;background:linear-gradient(180deg,#40dbe0,#0f5fc0);border-radius:8px 8px 0 0}
.bv{font-size:11px;color:var(--mute);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.bl{margin-top:6px;font-size:12px}
.hrow{margin-bottom:12px}.hl{display:flex;justify-content:space-between;gap:8px}.hb{height:8px;background:#eef4fb;border-radius:6px;margin-top:4px;overflow:hidden}.hb i{display:block;height:100%;background:linear-gradient(90deg,#1596d6,#40dbe0)}
.trkcard .body{padding:16px 20px}
.trkgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch}
.trkgrid .trkcard{min-width:0;display:flex;flex-direction:column}
.trkgrid .trkcard .body{padding:14px 16px;flex:1;display:flex;flex-direction:column}
/* Kartu tertutup: bar progres menempel di bawah kartu, jadi semua kartu sebaris sama tinggi dan bar-nya sejajar */
.trkgrid .trkcard:not(.open) .trkhead{margin-bottom:12px}
.trkgrid .trkcard:not(.open) .pbar{margin-top:auto}
@media(max-width:1100px){.trkgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.trkgrid{grid-template-columns:1fr}}
.trkhead{display:flex;align-items:center;gap:14px;width:100%;border:0;border-radius:0;background:transparent;padding:0;text-align:left}
.tl1{flex:1;min-width:0}.tl1 b{display:block;font-size:15px;color:#0d2a57}.tl1 small{color:var(--mute)}
.tl2{display:flex;flex-direction:column;align-items:flex-end;gap:2px}.tl2 small{color:var(--mute)}
.pbar{height:6px;background:#e3edf8;border-radius:6px;margin:12px 0 4px;overflow:hidden}.pbar i{display:block;height:100%;background:linear-gradient(90deg,#1596d6,#40dbe0);border-radius:6px;transition:width .4s}
.pager{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 4px}
.pager .pgnums{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.pager .pgnums button{min-width:30px;height:30px;padding:0 6px;border-radius:8px;border:1px solid rgba(13,42,87,.18);background:rgba(255,255,255,.7);color:#0d2a57;cursor:pointer}
.pager .pgnums button.on{background:linear-gradient(180deg,#0a3a8e,#1295d6);color:#fff;border-color:transparent;font-weight:700}
.pager .pgnums em{font-style:normal;color:var(--mute);padding:0 2px}
.pager button.ghost:disabled{opacity:.45;cursor:default}
.tl{list-style:none;margin:18px 0 8px;padding:0}
.tl li{position:relative;display:flex;gap:14px;padding-bottom:22px}.tl li:last-child{padding-bottom:4px}
.tl li::before{content:"";position:absolute;left:13px;top:30px;bottom:-2px;width:2px;background:#d3e2f2}
.tl li:last-child::before{display:none}.tl li.ok::before{background:#7ccf9b}
.tl li>i{flex:none;z-index:1;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#eef3fa;color:#8a9bb5;font-style:normal}
.tl li.ok>i{background:#157347;color:#fff}
.tl li.cur>i{background:#e6a817;color:#fff;animation:pulse 1.8s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(230,168,23,.45)}50%{box-shadow:0 0 0 7px rgba(230,168,23,0)}}
.tl .dt{width:8px;height:8px;border-radius:50%;background:#b8c6da}
.tc{flex:1;min-width:0;padding-top:2px}.th{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tl li.open .th b{color:#7487a3}.tl li.ok .th b{color:#0d2a57}.tl li.cur .th b{color:#8a5b00}
.tc small{display:block;color:var(--mute);margin-top:2px}
.tedit{display:flex;gap:8px;align-items:center;margin-top:8px}.tedit input{width:auto;min-height:38px;padding:6px 10px}
.s-wait{background:#eef2f7;color:#6b7c95}
@media(prefers-reduced-motion:reduce){.tl li.cur>i{animation:none}}
/* ---- Master Supplier ---- */
.msdrop{border:2px dashed #9cc7f2;border-radius:14px;background:#f6faff;padding:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;transition:background .15s,border-color .15s}
.msdrop.on{background:#e3f1ff;border-color:var(--brand)}
.msdrop .msico{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--soft);color:var(--brand);flex:none}
.msdrop .mst{flex:1;min-width:240px}.msdrop .mst b{display:block;color:#0d2a57}.msdrop .mst small{color:var(--mute);display:block;margin-top:2px}
.mspv{border:1px solid var(--line);border-radius:14px;background:#fff;padding:14px 16px;margin-bottom:16px}
.mspv>b{display:block;color:#0d2a57}
.mschips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px}
.mschip{padding:3px 11px;border-radius:999px;font-size:12.5px;font-weight:700;background:#eef5ff;color:#0d3b7a;white-space:nowrap}
.mschip.ok{background:#e4f6ec;color:#157347}.mschip.warn{background:#fff3d6;color:#8a5b00}
.msmiss{color:#8a5b00;font-size:12px;font-weight:600}.msok{color:#157347;font-size:12.5px;font-weight:700}
.msuse{padding:4px 14px;border-radius:12px;font-size:12.5px;font-weight:700;white-space:nowrap}
.mst-t td .ghost+.ghost{margin-left:6px}
/* ---- Supplier BP ---- */
.bpbox{border:1px solid var(--line);border-radius:14px;background:#f6faff;padding:14px 16px;margin-bottom:16px}
.bpbox>b{display:block;margin-bottom:10px;color:#0d2a57}.bpbox p{margin:8px 0 0}
.bpf{display:grid;grid-template-columns:140px minmax(0,1fr) 190px auto;gap:12px;align-items:end}.bpf .fld{margin:0}.bpf .acts{padding-bottom:1px}
@media(max-width:900px){.bpf{grid-template-columns:1fr 1fr}}
.bad{color:#b42318;font-weight:600}.warnt{color:#8a5b00;font-weight:600}
.bpw{margin-top:6px;font-size:12.5px;color:#8a5b00;background:#fff3d6;border-radius:8px;padding:6px 10px}.bpw.bad{color:#b42318;background:#fde8e8;font-weight:400}
.nt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;margin-bottom:8px;padding:12px 14px;border-radius:14px;background:#fff}
.nt.un{background:#eaf5ff;border-color:#9cc7f2}
.nti{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--soft);color:var(--brand);flex:none}
.ntt{flex:1}.ntt b{display:block}.ntt small{color:var(--mute)}
.dot{width:10px;height:10px;border-radius:50%;background:#ff4d5e}
@media(max-width:900px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;border-radius:0 0 22px 22px}
  .navlist{flex-direction:row;flex-wrap:wrap}.nv{width:auto}.sep,.nv.grp,.sub{display:none}
  .navpill{display:none}
  .top{flex-wrap:wrap}.gs{order:5;max-width:none;margin-left:0;flex-basis:100%}
  .two{grid-template-columns:1fr}
}
/* ---- Dokumen PO & riwayat supplier ---- */
.viewer{display:flex;flex-direction:column;gap:10px}
.vbar{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
.vsel{flex:1;min-width:260px}.vsel label{margin-bottom:4px}
.vinfo{flex:1;min-width:200px}.vinfo small{display:block;color:var(--mute)}
.vact{display:flex;gap:8px;flex-wrap:wrap}
.vpaper{background:#cfd6e0;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:hidden}
.vpaper>div{margin:0 auto}
.vpaper iframe{display:block;border:0;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.modal{position:fixed;inset:0;z-index:50;background:rgba(10,20,40,.6);overflow:auto;padding:20px;display:flex;justify-content:center;align-items:flex-start}
.modal .viewer{background:#fff;border-radius:10px;padding:16px;width:100%;max-width:900px}
.hist{border:1px solid var(--line);border-radius:8px;margin-top:10px;background:#fafcff}
.hhead{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;padding:10px 12px}
.hhead small{display:block;color:var(--mute);font-weight:400}
.hbody{padding:0 12px 12px}
.hhead .ht{flex:1;text-align:left;min-width:0}.hhead .ht b{display:block}
.hi{width:46px;height:46px;border-radius:12px;display:grid;place-items:center;flex:none;color:#1558b8;background:linear-gradient(145deg,#eef7ff,#cfe5fb);border:1px solid #fff;box-shadow:0 3px 10px rgba(40,100,180,.15)}
.hhead{gap:12px}
.chk{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:6px 0}.chk input{width:auto;margin-top:3px}
.lnk{border:0;background:none;padding:0;color:var(--brand);text-decoration:underline;text-align:left}
button:disabled{opacity:.5;cursor:not-allowed}
/* ---- Login: 3D flip + glassmorphism ---- */
.auth{--ease:cubic-bezier(.45,.05,.2,1);min-height:100vh;display:grid;place-items:center;padding:16px;position:relative;overflow:hidden;background:linear-gradient(135deg,#0a1d42 0%,#123f86 45%,#1b6fd1 100%)}
.auth::before,.auth::after{content:"";position:absolute;border-radius:50%;filter:blur(60px);opacity:.75;animation:drift 14s ease-in-out infinite alternate}
.auth::before{width:380px;height:380px;left:-90px;top:-80px;background:#22d3ee}
.auth::after{width:420px;height:420px;right:-110px;bottom:-120px;background:#a855f7;animation-delay:-6s}
@keyframes drift{to{transform:translate(60px,40px) scale(1.15)}}
.scene{position:relative;z-index:1;width:100%;max-width:400px;display:grid;perspective:1400px}
.authbox{padding:26px 24px}.authbox p{margin:2px 0 14px}.fld{margin-bottom:12px}
.face{grid-area:1/1;position:relative;overflow:hidden;display:flex;flex-direction:column;color:#fff;border-radius:20px;border:1px solid rgba(255,255,255,.38);
  background:linear-gradient(135deg,rgba(255,255,255,calc(.26*var(--g,1))),rgba(255,255,255,calc(.07*var(--g,1))) 45%,rgba(255,255,255,calc(.14*var(--g,1))));
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
  -webkit-backface-visibility:hidden;backface-visibility:hidden;visibility:hidden;
  transition:transform .9s var(--ease),visibility 0s linear .45s;animation:glow 4s ease-in-out infinite alternate}
.face.act{visibility:visible;transition:transform .9s var(--ease),visibility 0s}
.face.f{transform:rotateY(0)}.face.b{transform:rotateY(180deg)}
.scene.flipped .face.f{transform:rotateY(-180deg)}.scene.flipped .face.b{transform:rotateY(0)}
@keyframes glow{
  from{box-shadow:0 10px 40px rgba(4,16,48,.45),0 0 18px rgba(125,200,255,.30),inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.06)}
  to{box-shadow:0 10px 40px rgba(4,16,48,.45),0 0 34px rgba(160,215,255,.60),inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.12)}}
.sheen{position:absolute;top:-20%;bottom:-20%;left:0;width:45%;pointer-events:none;z-index:3;opacity:0;
  background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,0) 30%,rgba(255,255,255,.5) 50%,rgba(255,255,255,0) 70%,transparent 100%);
  transform:translateX(-130%) skewX(-18deg)}
.face.act .sheen{animation:sweep .95s ease-in-out .2s both}
@keyframes sweep{0%{opacity:1;transform:translateX(-130%) skewX(-18deg)}100%{opacity:1;transform:translateX(330%) skewX(-18deg)}}
.auth .face h1{color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.35);text-align:center}
.auth .face>p.mute,.auth .face .logobox+h1+p{text-align:center}
.logobox{background:#fff;border-radius:12px;padding:6px 10px;margin:0 auto 12px;display:flex;justify-content:center;align-items:center;box-shadow:0 4px 18px rgba(0,0,0,.25);max-width:100%}
.logobox img{display:block;max-height:64px;max-width:220px;width:auto;height:auto;object-fit:contain}
.auth.hasbg::before{inset:0;width:auto;height:auto;border-radius:0;filter:none;opacity:1;animation:none;background:rgba(8,20,48,.28)}
.auth.hasbg::after{display:none}
.prev{border:1px solid var(--line);border-radius:8px;min-height:110px;display:flex;align-items:center;justify-content:center;background:#f9fbfe}
.prev.logo{background:#fff;padding:10px}.prev.logo img{max-height:90px;max-width:100%;object-fit:contain}
.prev.bg{background:linear-gradient(135deg,#0a1d42,#1b6fd1) center/cover no-repeat;color:#fff;font-size:12px;height:140px}
.btnfile{display:inline-block;margin:0;padding:8px 14px;border:1px solid var(--brand);border-radius:6px;background:var(--brand);color:#fff;font-weight:600;cursor:pointer}
input[type=range]{padding:0}
.auth .face .mute{color:rgba(255,255,255,.78)}
.authbox p.foot{margin:auto 0 0;padding-top:10px}
.auth .face label{color:rgba(255,255,255,.95)}.auth .face label i{color:#ffb4bd}
.auth .face input,.auth .face select{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.32);color:#fff}
.auth .face select option{color:#14243d;background:#fff}
.auth .face input:focus,.auth .face select:focus,.auth .face button:focus-visible{outline:2px solid rgba(255,255,255,.85);outline-offset:1px;box-shadow:0 0 12px rgba(160,215,255,.6)}
.auth .face input:-webkit-autofill{-webkit-text-fill-color:#fff;caret-color:#fff;box-shadow:0 0 0 100px rgba(40,90,170,.55) inset}
.auth .face .tabs button{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.3);color:#fff}
.auth .face .tabs .on{background:rgba(255,255,255,.3);border-color:rgba(255,255,255,.6);font-weight:600}
.auth .face .pri{background:linear-gradient(135deg,#3da0ff,#1558b8);border:1px solid rgba(255,255,255,.45);box-shadow:0 4px 18px rgba(21,88,184,.55)}
.auth .face .eye{color:#fff;background:transparent;border:0;box-shadow:none}
.auth .face .info{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.35);color:#fff}
@media(prefers-reduced-motion:reduce){.face{transition:none;animation:none}.face.act{transition:none}.face.act .sheen{animation:none}.auth::before,.auth::after{animation:none}}
.tabs{display:flex;gap:6px;margin-bottom:14px}.tabs button{flex:1}.tabs .on{background:var(--brand);color:#fff;border-color:var(--brand)}
.pw{position:relative}.pw input{padding-right:42px}
.eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);border:0;background:transparent;padding:4px 8px;font-size:16px;line-height:1}
.note{font-size:12px;color:#157347;margin-top:4px;line-height:1.35}.note.bad{color:#b42318}
.item{border:1px solid var(--line);border-radius:8px;padding:12px;margin-bottom:12px;background:#fafcff}
.ihead{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.ihead button{padding:4px 10px}
.item .fld{margin:0}
.acts.fx button{min-width:82px;justify-content:center}.acts.fx{flex-wrap:nowrap}
.ctbl th,.ctbl td{padding:8px 12px;vertical-align:middle}.ctbl td{font-size:13px;line-height:1.4}.ctbl th{white-space:nowrap}
.ctbl td:first-child,.ctbl th:first-child{width:44px;text-align:center}.ctbl td:nth-child(2){min-width:170px}.ctbl td:nth-child(4),.ctbl td:nth-child(5){min-width:170px}
.ctbl td:last-child,.ctbl th:last-child{width:1%;white-space:nowrap}.ctbl .tag{white-space:nowrap}
.trhint{font-size:11.5px;color:var(--mute);margin-top:4px}.trhint b{color:var(--brand)}.trref{display:flex;flex-wrap:wrap;gap:14px;margin-top:6px;font-size:11.5px;color:var(--mute)}.trref i{display:inline-block;width:18px;border-top:2px dashed;margin-right:6px;vertical-align:middle}.trref b{color:#12315f}
.exs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}.exs small{color:var(--mute)}.exs button{padding:1px 10px;font-size:12px;line-height:1.45;border-radius:12px;color:var(--brand);border-color:var(--brand2);background:rgba(255,255,255,.6)}
.slink{margin-top:6px;display:flex;flex-direction:column;gap:6px}.slink .tedit{flex-wrap:wrap;margin-top:0}.slink a{font-size:13px;color:var(--brand);font-weight:600;word-break:break-all}
.r1{display:grid;grid-template-columns:minmax(0,1fr) 90px 130px;gap:10px;margin-bottom:10px}
.r2{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media(max-width:640px){.r1{grid-template-columns:1fr 1fr}.r1>:first-child{grid-column:1/-1}.r2{grid-template-columns:1fr 1fr}}
/* ---- Dashboard ---- */
.mfil{margin-left:auto;display:flex;align-items:center;gap:7px;background:#fff;border:1px solid #cfe0f2;border-radius:10px;padding:0 10px;height:32px;color:#27487c;font-weight:600}
.mfil select{border:0;background:transparent;min-height:0;height:30px;width:auto;padding:0 2px;appearance:none;-webkit-appearance:none;font-weight:600;font-size:12.5px;color:#12315f;cursor:pointer}
.mfil select:focus{outline:none}
.kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin-bottom:14px}
.kpi{display:flex;align-items:center;gap:12px;padding:14px;margin:0}
.kic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;flex:none;box-shadow:0 6px 14px rgba(30,90,170,.25)}
.kb{min-width:0}.kb small{display:block;color:var(--mute);font-size:12px}
.kb b{display:block;font-size:clamp(18px,1.8vw,25px);line-height:1.15;color:#0d2a57;white-space:nowrap}
.kpi:last-child .kb b{font-size:clamp(15px,1.35vw,20px)}
.kd{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--mute)}
.kd em{font-style:normal;font-weight:700}.kd .good{color:#12a05c}.kd .bad{color:#e03546}.kd .flat{color:#7487a3}
.drow{display:grid;gap:14px;margin-bottom:14px}
.d3{grid-template-columns:1.35fr 1fr 1.1fr}.d2{grid-template-columns:1.05fr 1fr}
.dcard{margin:0;overflow:hidden}
.dh{display:flex;align-items:center;gap:9px;padding:12px 14px 2px}
.dic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#1e6fd0;background:linear-gradient(145deg,#eaf4ff,#cfe4fb);flex:none}
.dh h3{margin:0;font-size:14px;color:#0d2a57}.dr{margin-left:auto;font-size:12px}
.db{padding:6px 14px 14px}
.vall{border:0;background:none;padding:0;color:var(--brand);font-weight:600;font-size:12px;display:inline-flex;gap:3px;align-items:center}
.lgd{display:flex;gap:12px;font-size:11px;color:var(--mute)}.lgd i{display:inline-block;width:10px;height:10px;border-radius:2px;background:#a9d4f5;margin-right:5px;vertical-align:-1px}.lgd i.ln{width:14px;height:2px;background:#1e5fc0;vertical-align:3px}
.trend{width:100%;height:auto;display:block}.trend .ax{font-size:9.5px;fill:#6b7c95}.trend .tt1{font-size:10.5px;font-weight:700;fill:#fff}.trend .tt2{font-size:8.5px;fill:#b9d3f5}
.donutwrap{display:flex;align-items:center;justify-content:center;gap:14px;padding-top:10px;flex-wrap:wrap}
.donut{width:132px;height:132px;flex:none}.dnum{font-size:24px;font-weight:700;fill:#0d2a57;text-anchor:middle}.dlbl{font-size:8.5px;fill:#6b7c95;text-anchor:middle}
.dleg{list-style:none;margin:0;padding:0;font-size:12px}.dleg li{display:flex;align-items:center;gap:7px;margin:9px 0;color:#34496b;white-space:nowrap}
.dleg i{width:9px;height:9px;border-radius:50%;flex:none}.dleg b{margin-left:auto;padding-left:10px;color:#0d2a57}.dleg span{color:var(--mute)}
.cseg{display:inline-flex;gap:4px;margin:4px 0 2px}.cseg button{padding:1px 12px;font-size:12px;line-height:1.45;border-radius:12px;font-weight:600;color:var(--brand);border-color:var(--brand2);background:rgba(255,255,255,.6)}.cseg button.on{background:linear-gradient(135deg,#1e7fe0,#0f5fc0);color:#fff;border-color:#0f5fc0}
.crow{display:grid;grid-template-columns:minmax(70px,1.1fr) 1.4fr auto;gap:8px;align-items:center;font-size:11.5px;margin:13px 0}
.cn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#27406a}.cv{color:#34496b;white-space:nowrap}
.cb{display:block;height:9px;background:#e6f0fa;border-radius:6px;overflow:hidden}
.cb i{display:block;height:100%;border-radius:6px}
.dtbl th,.dtbl td{padding:6px 9px;font-size:12px}.dtbl th{white-space:nowrap}
.ell{display:block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dtbl .lnk{font-size:12px}
.pc{display:flex;align-items:center;gap:8px}.pc .cb{flex:1;min-width:46px}.pc>span:last-child{font-size:11.5px;color:var(--mute);width:32px;text-align:right}
.lm{display:inline-block;border-radius:10px;padding:2px 10px;font-weight:600;font-size:11.5px;white-space:nowrap}
.lm.a{background:#fff3d6;color:#8a5b00}.lm.b{background:#ffe3cf;color:#b45309}.lm.c{background:#fde0e0;color:#b42318}
@media(max-width:1250px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1150px){.d3,.d2{grid-template-columns:1fr}}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* ---- Animasi masuk (saat pindah halaman lewat sidebar) ---- */
@keyframes pgIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes riseIn{from{opacity:0;transform:translateY(16px) scale(.98)}to{opacity:1;transform:none}}
@keyframes growY{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes growX{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes pop{from{opacity:0;transform:scale(.2)}to{opacity:1;transform:scale(1)}}
@keyframes dsweep{from{stroke-dashoffset:100}to{stroke-dashoffset:0}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.pg{animation:pgIn .45s cubic-bezier(.2,.8,.2,1) both}
.kpi,.dcard{animation:riseIn .55s cubic-bezier(.2,.8,.2,1) both}
.drow>.dcard:nth-child(2){animation-delay:.09s}.drow>.dcard:nth-child(3){animation-delay:.18s}
.gbar{transform-box:fill-box;transform-origin:50% 100%;animation:growY .8s cubic-bezier(.2,.8,.2,1) both}
.gline{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 1.1s .35s ease forwards}
.gdot{transform-box:fill-box;transform-origin:center;animation:pop .4s cubic-bezier(.3,1.5,.5,1) both}
.gtip{animation:fadeIn .4s 1.1s both}
.dreveal{stroke-dasharray:100 100;animation:dsweep 1.15s .15s cubic-bezier(.3,.6,.3,1) both}
.cb i{transform-origin:left;animation:growX .9s cubic-bezier(.2,.8,.2,1) both}
.bcol .bb i{transform-origin:bottom;animation:growY .8s cubic-bezier(.2,.8,.2,1) both}
.hb i{transform-origin:left;animation:growX .9s cubic-bezier(.2,.8,.2,1) both}
.pbar i{transform-origin:left;animation:growX .8s cubic-bezier(.2,.8,.2,1) both}
.tl li{animation:riseIn .45s cubic-bezier(.2,.8,.2,1) both}
.tl li:nth-child(2){animation-delay:.07s}.tl li:nth-child(3){animation-delay:.14s}.tl li:nth-child(4){animation-delay:.21s}.tl li:nth-child(5){animation-delay:.28s}.tl li:nth-child(6){animation-delay:.35s}
@media(prefers-reduced-motion:reduce){.pg,.kpi,.dcard,.gbar,.gdot,.gtip,.dreveal,.cb i,.bcol .bb i,.hb i,.pbar i,.tl li{animation:none!important}.gline{animation:none;stroke-dashoffset:0}}

/* ---- Login & Daftar: kartu diringkas (~30%) agar muat satu layar ---- */
.auth .scene{max-width:300px}
.auth .authbox{padding:16px 18px;border-radius:16px}
.auth .face h1{font-size:19px;line-height:1.2;margin:2px 0 0}
.auth .authbox p{margin:1px 0 8px;font-size:12px}
.auth .logobox{margin:0 auto 6px;padding:5px 9px;border-radius:10px}
.auth .logobox img{max-height:38px;max-width:150px}
.auth .face label{font-size:12px;margin-bottom:3px}
.auth .fld{margin-bottom:8px}
.auth .face input,.auth .face select{min-height:34px;padding:6px 11px;font-size:13px;border-radius:9px}
.auth .pw input{padding-right:34px}
.auth .tabs{margin-bottom:8px}
.auth .face .tabs button{padding:6px 10px;font-size:13px}
.auth .face .pri.wide{padding:8px 12px;margin-top:2px}
.auth .face .info{padding:7px 10px;font-size:12px;margin-bottom:8px}
.auth .authbox p.foot{font-size:11px;padding-top:6px}

/* ---- Tombol aksi di tabel pengajuan: seragam & rapi (2 kolom) ---- */
.abtn{display:grid;grid-template-columns:repeat(2,minmax(94px,1fr));gap:6px;min-width:204px}
.abtn button{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:30px;padding:5px 8px;border-radius:8px;font-size:12.5px;font-weight:600;line-height:1.2;white-space:nowrap}
.abtn .cx{background:#fff;color:#d6334a;border:1px solid #ef8a97}
.abtn .cx:hover{background:#fde8ea}
/* ---- Login & Daftar: huruf putih tegas tanpa efek menyala (mudah dibaca) ---- */
.auth{--tsh:0 1px 2px rgba(0,20,60,.45)}
.auth .face{background:linear-gradient(135deg,rgba(18,66,160,calc(.34*var(--g,1))),rgba(8,36,104,calc(.2*var(--g,1))) 45%,rgba(28,88,190,calc(.3*var(--g,1))));border-color:rgba(190,230,255,.55)}
.auth .face h1{color:#fff;font-weight:800;text-shadow:var(--tsh)}
.auth .face label,.auth .face .mute,.auth .face .mute.small,.auth .face .foot{color:#fff;font-weight:600;text-shadow:var(--tsh)}
.auth .face .mute{color:#e8f4ff}
.auth .face label i{color:#ffb3c0;text-shadow:none}
.auth .face input,.auth .face select{color:#fff;font-weight:500;text-shadow:none;background:rgba(6,32,96,.42);border:1px solid rgba(170,225,255,.75)}
/* Isian login/daftar model embos ke dalam (lubang) persis referensi neumorphic: palung biru tua + bayangan dalam */
.auth .face input,.auth .face select{background:rgba(2,18,56,.78);border:1px solid rgba(0,0,0,.45);box-shadow:inset 0 4px 12px rgba(0,0,0,.6),inset 0 -1px 0 rgba(255,255,255,.14)}
.auth .face input::placeholder{color:rgba(215,238,255,.72);text-shadow:none}
.auth .face input:focus,.auth .face select:focus{border-color:rgba(0,0,0,.45);box-shadow:inset 0 4px 12px rgba(0,0,0,.6),inset 0 -1px 0 rgba(255,255,255,.14);outline:2px solid rgba(255,255,255,.9);outline-offset:1px}
.auth .face input:-webkit-autofill{-webkit-text-fill-color:#fff;caret-color:#fff;box-shadow:0 0 0 100px rgba(2,18,56,.95) inset}
.auth .face .tabs button{color:#fff;font-weight:600;text-shadow:none;background:rgba(6,32,96,.34);border-color:rgba(170,225,255,.6)}
.auth .face .tabs .on{background:rgba(56,150,255,.55);border-color:#d4f0ff;box-shadow:none}
/* Tab Masuk/Daftar model embos ke dalam: wadah seperti lubang (cekung), tab aktif timbul mengkilap */
.auth .face .tabs{display:flex;gap:0;padding:4px;border-radius:999px;background:rgba(2,18,56,.72);border:1px solid rgba(0,0,0,.45);box-shadow:inset 0 4px 12px rgba(0,0,0,.6),inset 0 -1px 0 rgba(255,255,255,.14)}
.auth .face .tabs button{flex:1;border:0;background:transparent;color:rgba(220,240,255,.75);border-radius:999px}
.auth .face .tabs .on{background:linear-gradient(180deg,#2ea8ff,#0a5fd6);color:#fff;font-weight:700;border:0;box-shadow:0 4px 12px rgba(0,40,120,.5),inset 0 1px 0 rgba(255,255,255,.6)}
.auth .face .pri{color:#fff;font-weight:700;text-shadow:none;background:linear-gradient(135deg,#1f86ff,#0b46b8);border:1px solid #a8e0ff;box-shadow:0 4px 12px rgba(5,30,90,.35)}
.auth .face .eye{color:#fff;text-shadow:none}
/* ---- Ambient Mesh Gradient + Gradient Shimmer pada LATAR BELAKANG halaman login ---- */
.auth.hasbg::after,.auth:not(.hasbg)::after{display:block;content:"";position:absolute;inset:-30%;width:auto;height:auto;border-radius:0;z-index:0;pointer-events:none;filter:none;opacity:.7;animation:authmesh 18s ease-in-out infinite alternate;will-change:transform;
  background:
    radial-gradient(34% 36% at 18% 22%,rgba(6,24,84,.92),transparent 70%),
    radial-gradient(32% 34% at 80% 18%,rgba(24,104,230,.8),transparent 70%),
    radial-gradient(36% 36% at 72% 80%,rgba(34,205,240,.72),transparent 70%),
    radial-gradient(34% 32% at 22% 78%,rgba(120,196,255,.62),transparent 70%),
    radial-gradient(28% 30% at 50% 50%,rgba(14,64,160,.6),transparent 72%)}
@keyframes authmesh{
  0%{transform:translate3d(-6%,-4%,0) rotate(0deg) scale(1)}
  33%{transform:translate3d(7%,-3%,0) rotate(50deg) scale(1.1)}
  66%{transform:translate3d(5%,7%,0) rotate(110deg) scale(1.03)}
  100%{transform:translate3d(-7%,5%,0) rotate(180deg) scale(1.12)}}
/* Pita cahaya (shimmer) tipis yang melintas pelan di atas gradasi */
.auth.hasbg::before{z-index:1;background:linear-gradient(115deg,transparent 38%,rgba(160,230,255,.2) 50%,transparent 62%) 120% 0/260% 100% no-repeat,rgba(8,20,48,.12);animation:authsweep 10s ease-in-out infinite}
@keyframes authsweep{0%{background-position:120% 0,0 0}60%,100%{background-position:-60% 0,0 0}}
@media(prefers-reduced-motion:reduce){.auth.hasbg::before,.auth.hasbg::after,.auth:not(.hasbg)::after{animation:none}}
/* ---- Slow Flowing Abstract Waves (loop sangat lambat 45–80 dtk) ---- */
.auth .waves{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:hidden}
.auth .waves .wv{transform-box:fill-box;transform-origin:center;will-change:transform}
.auth .waves .w1{animation:wvf1 52s ease-in-out infinite alternate}
.auth .waves .w2{animation:wvf2 68s ease-in-out infinite alternate}
.auth .waves .w3{animation:wvf3 78s ease-in-out infinite alternate}
.auth .waves .w4{animation:wvf2 90s ease-in-out infinite alternate-reverse;opacity:.8}
@keyframes wvf1{0%{transform:translate3d(-90px,10px,0) rotate(-1.2deg)}50%{transform:translate3d(10px,-24px,0) rotate(.6deg)}100%{transform:translate3d(100px,16px,0) rotate(1.4deg)}}
@keyframes wvf2{0%{transform:translate3d(110px,-8px,0) rotate(1deg)}50%{transform:translate3d(-20px,22px,0) rotate(-.8deg)}100%{transform:translate3d(-100px,-12px,0) rotate(-1.4deg)}}
@keyframes wvf3{0%{transform:translate3d(-70px,-14px,0) rotate(.8deg)}100%{transform:translate3d(90px,20px,0) rotate(-1deg)}}
@media(prefers-reduced-motion:reduce){.auth .waves .wv{animation:none}}
/* ---- Tombol Masuk / Kirim pendaftaran: loading state ---- */
.auth .face .sbtn{justify-content:center;text-align:center;position:relative;overflow:hidden;transition:background .3s,opacity .2s,box-shadow .3s}
.auth .face .sbtn .sbl{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:8px}
.auth .face .sbtn:disabled{cursor:not-allowed}
.auth .face .sbtn.loading:not(.ok){opacity:.78;filter:saturate(.8) brightness(.92)}
.auth .face .sbtn .pbfill{position:absolute;left:0;top:0;bottom:0;z-index:0;background:linear-gradient(90deg,rgba(255,255,255,.1),rgba(255,255,255,.38));border-right:2px solid rgba(255,255,255,.8);transition:width .12s linear}
.auth .face .sbtn .spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:authspin .7s linear infinite;flex:none}
@keyframes authspin{to{transform:rotate(360deg)}}
.auth .face .sbtn.ok{opacity:1;filter:none;background:linear-gradient(135deg,#27c46b,#128a47);border-color:#b8f5d2;box-shadow:0 4px 14px rgba(10,110,55,.45)}
.auth .face .sbtn .chk{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#fff;color:#128a47;font-size:12px;font-weight:900;animation:pop .35s cubic-bezier(.2,.8,.2,1) both}
/* Overlay + shimmer pada formulir Daftar selama pemrosesan */
.auth .face.formbusy::after{content:"";position:absolute;inset:0;border-radius:inherit;z-index:5;pointer-events:all;cursor:progress;background:linear-gradient(105deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.22) 50%,rgba(255,255,255,0) 70%) -150% 0/250% 100% no-repeat,rgba(6,28,84,.28);animation:authshim 1.2s linear infinite}
@keyframes authshim{to{background-position:150% 0,0 0}}
.auth .face input:disabled,.auth .face select:disabled{opacity:.7;cursor:not-allowed}
.auth .face .tabs button:disabled{cursor:not-allowed;opacity:.75}
@media(prefers-reduced-motion:reduce){.auth .face .sbtn .spin{animation-duration:1.6s}.auth .face.formbusy::after{animation:none}}
.auth .face .info{color:#fff;font-weight:600;text-shadow:none;background:rgba(6,32,96,.5);border-color:rgba(170,225,255,.65)}

/* ---- Dashboard: efek kaca ---- */
.dash{position:relative;isolation:isolate}
.dash::before{content:"";position:absolute;inset:-24px -10px;z-index:-1;pointer-events:none;filter:blur(8px);
  background:radial-gradient(260px 200px at 10% 12%,rgba(45,212,216,.42),transparent 70%),radial-gradient(320px 240px at 88% 30%,rgba(80,140,255,.38),transparent 70%),radial-gradient(300px 230px at 40% 62%,rgba(150,120,255,.22),transparent 70%),radial-gradient(300px 220px at 85% 92%,rgba(45,212,216,.3),transparent 70%)}
.kpi,.dcard{position:relative;background:linear-gradient(135deg,rgba(255,255,255,.62),rgba(255,255,255,.26) 48%,rgba(255,255,255,.44));
  -webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);border:1px solid rgba(255,255,255,.75);
  box-shadow:0 8px 30px rgba(31,90,170,.16),inset 0 1px 0 rgba(255,255,255,.95),inset 0 0 0 1px rgba(255,255,255,.18);transition:box-shadow .25s}
.kpi:hover,.dcard:hover{box-shadow:0 12px 36px rgba(31,110,210,.26),0 0 22px rgba(90,200,255,.3),inset 0 1px 0 rgba(255,255,255,.95)}
.kpi::after,.dcard::after{content:"";position:absolute;top:-30%;bottom:-30%;left:0;width:38%;pointer-events:none;opacity:0;
  background:linear-gradient(105deg,transparent,rgba(255,255,255,.6),transparent);transform:translateX(-140%) skewX(-18deg);animation:dsheen 1.3s .35s ease-out both}
@keyframes dsheen{0%{opacity:0;transform:translateX(-140%) skewX(-18deg)}15%{opacity:1}100%{opacity:0;transform:translateX(400%) skewX(-18deg)}}
.dcard .dtbl th{background:rgba(214,234,252,.62)}
.dcard .tbl table,.dcard th,.dcard td{border-color:rgba(160,195,235,.45)}
.dcard .tbl tbody tr:nth-child(odd) td{background:rgba(255,255,255,.32)}
.dcard .tbl tbody tr:nth-child(even) td{background:rgba(120,180,240,.14)}
.dic{background:linear-gradient(145deg,rgba(255,255,255,.9),rgba(190,220,250,.8));box-shadow:0 2px 8px rgba(40,100,180,.18)}
@media(prefers-reduced-motion:reduce){.kpi::after,.dcard::after{animation:none}}

/* ---- Form Buat PO: kartu kiri & kanan sejajar per baris ---- */
.two{align-items:start}
.two>.cl{grid-column:1}.two>.cr{grid-column:2}
.two>.cl>.card,.two>.cr>.card{margin-bottom:0}
.two>.cr>.card+.card{margin-top:12px}
@media(max-width:1100px){.two>.cl,.two>.cr{grid-column:auto}.two>.cl{order:1}.two>.cr{order:2}}
/* ---- Rank Top 10 Supplier: angka tepat di tengah bulatan ---- */
.rk{display:inline-flex;align-items:center;justify-content:center;line-height:1;padding:0;text-align:center;flex:none}
/* ---- Tabel Supplier BP ---- */
.bpt td,.bpt th{white-space:nowrap}
.bpt td{font-size:14px}
.bpt td:first-child b{font-size:14px;font-weight:700}
.bpt{table-layout:fixed;width:100%}
.bpt th:nth-child(1){width:19%}.bpt th:nth-child(2){width:26%}.bpt th:nth-child(3){width:14%}.bpt th:nth-child(4){width:17%}.bpt th:nth-child(5){width:15%}
.bpt td:nth-child(2){white-space:normal}
.bpst{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:700;white-space:nowrap;background:none;padding:0}
.bpst i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.bpst.ak{color:#157347}.bpst.so{color:#8a5b00}.bpst.ex{color:#b42318}


/* ---- Logo login beranimasi (tanpa emas): Terangkai Cepat + Shimmer putih kebiruan + Beacon Glow biru + Pulse & Flash ---- */
.auth .logobox.alogo{box-sizing:border-box;position:relative;overflow:visible;padding:18px 16px 14px;margin:0 auto 10px;width:100%;max-width:100%;border-radius:16px;--al:9s;background:linear-gradient(180deg,#ffffff 0%,#eef5ff 100%);box-shadow:0 12px 30px rgba(4,16,48,.18),inset 0 0 0 1px rgba(170,205,255,.9)}
/* panel putih + sorot cahaya dari atas, seperti panggung logo di video referensi */
.auth .logobox.alogo::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:repeating-conic-gradient(from 172deg at 50% -12%,rgba(140,200,255,.20) 0deg 8deg,transparent 8deg 20deg),radial-gradient(65% 60% at 50% 0%,rgba(190,225,255,.6),transparent 70%)}
/* video logo login: tampil sebagai jendela gelap membulat di atas panel putih (background video gelap bawaan) */
.alogo .al-swap{position:relative;z-index:1;width:230px;max-width:100%;height:50px;margin:0 auto}
.alogo .al-video{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 47%;border-radius:10px;box-shadow:0 8px 24px rgba(4,16,48,.35);background:#04081a;transition:opacity .9s ease,transform .9s cubic-bezier(.4,0,.2,1),filter .9s ease}
/* logo asli (latar putih) masuk: membesar-mengecil halus + blur hilang + kilau biru menyapu */
/* logo asli: latar putih polos, di tengah, 17% lebih besar dari jendela video, tetapi lebarnya selalu dibatasi lebar kotak putih (100cqw) agar tidak keluar. Selector panjang agar menang atas ".auth .logobox img" yang membatasi ukuran. */
.auth .logobox.alogo .al-swap .al-logo{position:absolute;inset:0;margin:auto;display:block;width:105%;width:min(117%,calc(100cqw - 24px));height:117%;max-width:none;max-height:none;object-fit:contain;object-position:center;opacity:0;transform:scale(1.18) translateY(5px);filter:blur(10px);transition:opacity .9s ease,transform .9s cubic-bezier(.2,.9,.3,1.2),filter .9s ease;pointer-events:none}
.auth .logobox.alogo{background:#fff;container-type:inline-size}
.auth .logobox.alogo::before{transition:opacity .9s ease}
.auth .logobox.alogo.show-logo::before{opacity:0}
.alogo .al-sweep{position:absolute;inset:0;border-radius:10px;overflow:hidden;pointer-events:none}
.alogo .al-sweep::after{content:"";position:absolute;top:-10%;bottom:-10%;left:0;width:42%;background:linear-gradient(105deg,transparent,rgba(120,185,255,.7),rgba(255,255,255,.9),transparent);opacity:0;transform:translateX(-140%) skewX(-18deg)}
.alogo .al-swap.is-logo .al-video{opacity:0;transform:scale(.86);filter:blur(7px)}
.auth .logobox.alogo .al-swap.is-logo .al-logo{opacity:1;transform:none;filter:none;transition-delay:.2s}
.alogo .al-swap.is-logo .al-sweep::after{animation:alSweep 1.1s ease-out .55s 1 both}
.alogo .al-swap.is-video .al-video{transition-delay:.25s}
@keyframes alSweep{0%{opacity:0;transform:translateX(-140%) skewX(-18deg)}20%{opacity:1}100%{opacity:0;transform:translateX(380%) skewX(-18deg)}}
@media(prefers-reduced-motion:reduce){.alogo .al-video,.alogo .al-logo{transition-duration:.01s;transition-delay:0s}.alogo .al-sweep::after{animation:none!important}}
/* panel video dibuat setipis pil logo lama, supaya tinggi totalnya sama seperti gambar kanan */
.auth .logobox.alogo.videobox{padding:8px 10px}
.alogo .al-stage{position:relative;width:260px;max-width:100%;line-height:0;isolation:isolate}
.alogo .al-stage img{display:block;width:100%;height:auto;max-height:none;max-width:none}
.alogo .al-stage img:not(.al-base){position:absolute;inset:0;pointer-events:none}
.alogo .al-aura{position:absolute;left:3%;top:-8%;width:34%;height:116%;border-radius:50%;pointer-events:none;z-index:0;opacity:0;
  background:radial-gradient(closest-side,rgba(40,130,255,.65),rgba(20,100,230,.28) 55%,transparent 75%);filter:blur(7px);animation:alAura var(--al) ease-in-out infinite}
/* lapisan dasar: hanya bagian teks (kanan logo) bila logo bawaan; teks menyusul dari kanan dengan sedikit efek "klik" */
.alogo .al-base{opacity:0;animation:alBase var(--al) ease-in-out infinite}
.alogo:not(.custom) .al-base{clip-path:polygon(23.8% 0,100% 0,100% 100%,23.8% 100%)}
/* 1) Terangkai cepat: atap terpecah jadi 4 pita yang meluncur bergantian dari kiri dan kanan, lalu menyatu */
.alogo .al-rw{position:absolute;inset:0;pointer-events:none;opacity:0}
.alogo .al-rb{position:absolute;inset:0;pointer-events:none;opacity:0}
.alogo .al-rb.rb1{clip-path:polygon(0 0,23.8% 0,23.8% 17%,0 17%);animation:alRb1 var(--al) cubic-bezier(.2,.9,.3,1.35) infinite}
.alogo .al-rb.rb2{clip-path:polygon(0 17%,23.8% 17%,23.8% 34%,0 34%);animation:alRb2 var(--al) cubic-bezier(.2,.9,.3,1.35) infinite}
.alogo .al-rb.rb3{clip-path:polygon(0 34%,23.8% 34%,23.8% 51%,0 51%);animation:alRb3 var(--al) cubic-bezier(.2,.9,.3,1.35) infinite}
.alogo .al-rb.rb4{clip-path:polygon(0 51%,23.8% 51%,23.8% 68%,0 68%);animation:alRb4 var(--al) cubic-bezier(.2,.9,.3,1.35) infinite}
/* shimmer putih kebiruan: sapuan cahaya diagonal dari tengah pilar ke kanan, hanya di atas piksel logo */
.alogo .al-shine{position:absolute;inset:0;z-index:4;pointer-events:none;opacity:0;mix-blend-mode:screen;
  -webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
  background:linear-gradient(105deg,transparent 40%,rgba(190,225,255,0) 44%,rgba(190,225,255,.95) 50%,rgba(255,255,255,.95) 52%,rgba(190,225,255,0) 58%,transparent 62%);
  background-size:260% 100%;background-repeat:no-repeat;background-position:120% 0;animation:alShine var(--al) ease-in-out infinite}
/* 2) Beacon Glow: pilar hitam naik kokoh, lalu garis atap biru menyala neon */
.alogo .al-pil{clip-path:polygon(0 68%,23.8% 68%,23.8% 100%,0 100%);opacity:0;animation:alPil var(--al) cubic-bezier(.2,.8,.2,1) infinite}
.alogo .al-rw{animation:alRoof var(--al) ease-in-out infinite}
.alogo .al-roof{clip-path:polygon(0 0,23.8% 0,23.8% 68%,0 68%)}
@keyframes alBase{0%,9%{opacity:0;transform:translateX(34px)}13%{opacity:1;transform:translateX(-2px)}15%,92%{opacity:1;transform:translateX(0)}98%,100%{opacity:0;transform:translateX(0)}}
@keyframes alRb1{0%{opacity:0;transform:translateX(-46px)}4%{opacity:1;transform:translateX(0)}13%{opacity:1;transform:translateX(0)}15%,100%{opacity:0;transform:translateX(0)}}
@keyframes alRb2{0%,2%{opacity:0;transform:translateX(46px)}6%{opacity:1;transform:translateX(0)}13%{opacity:1;transform:translateX(0)}15%,100%{opacity:0;transform:translateX(0)}}
@keyframes alRb3{0%,4%{opacity:0;transform:translateX(-46px)}8%{opacity:1;transform:translateX(0)}13%{opacity:1;transform:translateX(0)}15%,100%{opacity:0;transform:translateX(0)}}
@keyframes alRb4{0%,6%{opacity:0;transform:translateX(46px)}10%{opacity:1;transform:translateX(0)}13%{opacity:1;transform:translateX(0)}15%,100%{opacity:0;transform:translateX(0)}}
@keyframes alShine{0%,17%{opacity:0;background-position:120% 0}18%{opacity:1;background-position:100% 0}31%{opacity:1;background-position:-20% 0}32%,100%{opacity:0;background-position:-20% 0}}
@keyframes alPil{0%,4%{opacity:0;transform:translateY(16px)}10%{opacity:1;transform:translateY(0)}92%{opacity:1;transform:translateY(0)}98%,100%{opacity:0;transform:translateY(0)}}
@keyframes alRoof{0%,14%{opacity:0;filter:none}16%{opacity:1;filter:drop-shadow(0 0 3px #5cc2ff) drop-shadow(0 0 10px #1a7bff) drop-shadow(0 0 22px rgba(40,140,255,.95)) brightness(1.3)}
  22%{opacity:1;filter:drop-shadow(0 0 1px #35a2ff) drop-shadow(0 0 4px rgba(26,123,255,.7)) brightness(1.08)}
  28%{opacity:1;filter:drop-shadow(0 0 3px #5cc2ff) drop-shadow(0 0 11px #1a7bff) drop-shadow(0 0 24px rgba(40,140,255,.95)) brightness(1.3)}
  34%,92%{opacity:1;filter:none}98%,100%{opacity:0;filter:none}}
@keyframes alAura{0%,15%{opacity:0;transform:scale(.7)}19%{opacity:.95;transform:scale(1.1)}25%{opacity:.3;transform:scale(.95)}31%{opacity:.9;transform:scale(1.12)}40%,100%{opacity:0;transform:scale(1.2)}}
/* 3) Grand Citadel Pulse & Flash: dipicu saat login berhasil (class .burst) */
.alogo .al-ring,.alogo .al-flash{position:absolute;left:50%;top:50%;border-radius:50%;pointer-events:none;opacity:0;z-index:5}
.alogo .al-ring{width:40px;height:40px;margin:-20px 0 0 -20px;border:2px solid rgba(160,215,255,.95);box-shadow:0 0 18px 4px rgba(90,170,255,.7),inset 0 0 14px rgba(160,215,255,.6)}
.alogo .al-flash{width:150px;height:150px;margin:-75px 0 0 -75px;background:radial-gradient(closest-side,rgba(255,255,255,.95),rgba(150,205,255,.5) 55%,transparent 75%)}
.auth .face .logobox.alogo.burst{animation:alPulse .95s cubic-bezier(.34,1.56,.64,1) forwards;box-shadow:0 4px 30px rgba(120,190,255,.9),0 0 50px 8px rgba(80,160,255,.6)}
.alogo.burst .al-ring.r1{animation:alRing .9s ease-out forwards}
.alogo.burst .al-ring.r2{animation:alRing .9s ease-out .18s forwards}
.alogo.burst .al-flash{animation:alFlash .7s ease-out forwards}
@keyframes alPulse{0%{transform:scale(1)}35%{transform:scale(1.14)}55%{transform:scale(.97)}75%{transform:scale(1.05)}100%{transform:scale(1.03);opacity:.9}}
@keyframes alRing{0%{opacity:.95;transform:scale(.6)}100%{opacity:0;transform:scale(9)}}
@keyframes alFlash{0%{opacity:0;transform:scale(.4)}25%{opacity:1}100%{opacity:0;transform:scale(2.6)}}
/* logo tampil statis & lengkap bila pengguna meminta gerakan dikurangi */
@media(prefers-reduced-motion:reduce){.alogo .al-base{animation:none;opacity:1}.alogo .al-pil{animation:none;opacity:1}.alogo .al-rw{animation:none;opacity:1;filter:none}.alogo .al-rb,.alogo .al-shine,.alogo .al-aura{animation:none;opacity:0}.auth .face .logobox.alogo.burst,.alogo.burst .al-ring,.alogo.burst .al-flash{animation:none}}

/* ---- Efek login berhasil: Glassmorphic Expansion & Fade-out, lalu dashboard muncul pelan ---- */
@keyframes loginExpand{
  0%{transform:rotateY(0) scale(1);opacity:1;box-shadow:0 10px 40px rgba(4,16,48,.45),0 0 18px rgba(125,200,255,.3),inset 0 1px 0 rgba(255,255,255,.55)}
  45%{transform:rotateY(0) scale(1.02);opacity:1;box-shadow:0 14px 50px rgba(4,16,48,.5),0 0 46px 8px rgba(110,190,255,.75),0 0 90px 18px rgba(70,150,255,.45),inset 0 1px 0 rgba(255,255,255,.7)}
  100%{transform:rotateY(0) scale(1.02);opacity:0;box-shadow:0 14px 50px rgba(4,16,48,.2),0 0 70px 14px rgba(110,190,255,.35),0 0 110px 24px rgba(70,150,255,.2),inset 0 1px 0 rgba(255,255,255,.4)}}
@keyframes loginBgOut{from{opacity:1}to{opacity:0}}
/* hanya opacity + fill-mode backwards: animasi transform yang "menempel" membuat .shell jadi acuan position:fixed, sehingga sidebar ikut ter-scroll & biru-nya terputus */
@keyframes appIn{from{opacity:0}to{opacity:1}}
.auth .scene.leaving .face.act{animation:loginExpand .95s cubic-bezier(.4,0,.2,1) forwards;pointer-events:none}
.auth.leaving{animation:loginBgOut .45s ease-in .6s forwards}
.shell{animation:appIn .7s cubic-bezier(.2,.8,.2,1) backwards}
@media(prefers-reduced-motion:reduce){.auth .scene.leaving .face.act,.auth.leaving,.shell{animation:none}}

/* ---- Ambient Fluid Wave: pita gelombang & pendaran cahaya bergerak melingkar, terlihat jelas tapi tetap halus ---- */
@keyframes fwA{0%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1)}25%{transform:translate3d(190px,-60px,0) rotate(2deg) scale(1.06,1.2)}50%{transform:translate3d(0,-120px,0) rotate(0deg) scale(1,1.32)}75%{transform:translate3d(-190px,-60px,0) rotate(-2deg) scale(1.06,1.2)}100%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1)}}
@keyframes fwB{0%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1)}25%{transform:translate3d(-170px,70px,0) rotate(-2.2deg) scale(1.08,.84)}50%{transform:translate3d(0,130px,0) rotate(0deg) scale(1,.72)}75%{transform:translate3d(170px,70px,0) rotate(2.2deg) scale(1.08,.84)}100%{transform:translate3d(0,0,0) rotate(0deg) scale(1,1)}}
.auth .waves{mix-blend-mode:screen}
.auth .waves .wv{filter:drop-shadow(0 0 14px rgba(120,210,255,.75))}
.auth .waves .wv path[stroke]{stroke-opacity:.9;stroke-width:3px}
.auth .waves .w1{animation:fwA 30s linear infinite;animation-timing-function:ease-in-out}
.auth .waves .w2{animation:fwB 38s linear infinite;animation-timing-function:ease-in-out}
.auth .waves .w3{animation:fwA 46s linear infinite reverse;animation-timing-function:ease-in-out}
.auth .waves .w4{animation:fwB 54s linear infinite reverse;animation-timing-function:ease-in-out;opacity:1}
@keyframes orbitA{from{transform:rotate(0deg) translateX(var(--r)) rotate(0deg)}to{transform:rotate(360deg) translateX(var(--r)) rotate(-360deg)}}
@keyframes orbitB{from{transform:rotate(360deg) translateX(var(--r)) rotate(-360deg)}to{transform:rotate(0deg) translateX(var(--r)) rotate(0deg)}}
@keyframes orbBreath{0%,100%{opacity:.7}50%{opacity:1}}
.auth .orb{position:absolute;z-index:1;pointer-events:none;border-radius:50%;filter:blur(28px);mix-blend-mode:screen;will-change:transform;
  animation:orbitA var(--t) linear infinite,orbBreath 8s ease-in-out infinite}
.auth .orb.o1{--r:220px;--t:36s;width:520px;height:520px;left:4%;top:2%;background:radial-gradient(circle,rgba(110,205,255,1),rgba(60,140,255,0) 70%)}
.auth .orb.o2{--r:260px;--t:48s;width:580px;height:580px;right:0%;bottom:-2%;background:radial-gradient(circle,rgba(80,240,250,.95),rgba(40,160,240,0) 70%);animation-name:orbitB,orbBreath;animation-delay:0s,-4s}
.auth .orb.o3{--r:180px;--t:60s;width:440px;height:440px;left:40%;top:46%;background:radial-gradient(circle,rgba(205,185,255,.95),rgba(130,110,255,0) 70%);animation-delay:-12s,-2s}
@media(prefers-reduced-motion:reduce){.auth .waves .wv,.auth .orb{animation:none}}

#toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#14243d;color:#fff;padding:10px 16px;border-radius:6px;z-index:60;max-width:90vw}

/* ---- Efek glass untuk sidebar & seluruh halaman (selain login) ---- */
.shell{position:relative;isolation:isolate}
.shell::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
  background:radial-gradient(420px 320px at 8% 18%,rgba(45,212,216,.4),transparent 70%),radial-gradient(520px 380px at 92% 20%,rgba(90,140,255,.34),transparent 70%),radial-gradient(480px 360px at 55% 78%,rgba(160,120,255,.2),transparent 70%),radial-gradient(420px 320px at 12% 92%,rgba(45,212,216,.32),transparent 70%)}
.side{background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.55),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(120,190,255,.35),transparent 60%),linear-gradient(180deg,rgba(10,58,142,.74) 0%,rgba(11,95,186,.62) 50%,rgba(18,149,214,.56) 100%);
  -webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,.38);border-left:0;
  box-shadow:8px 0 32px rgba(10,60,140,.26),inset 0 1px 0 rgba(255,255,255,.55),inset -1px 0 0 rgba(255,255,255,.22)}
.logoph{background:transparent;-webkit-backdrop-filter:none;backdrop-filter:none;border:0}
.nv{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.14);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.nv:hover{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.4)}
.nv.on,.nv.on:hover{background:transparent;border-color:transparent;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;font-weight:600}
@media(max-width:900px){.nv.on,.nv.on:hover{background:linear-gradient(90deg,rgba(23,169,238,.85),rgba(64,226,238,.7));border-color:rgba(255,255,255,.85);box-shadow:0 0 16px rgba(90,225,255,.55)}}
.nv.grp{background:transparent;border-color:transparent;-webkit-backdrop-filter:none;backdrop-filter:none}
.nv.grp:hover{background:linear-gradient(90deg,rgba(150,215,255,.32),rgba(190,240,255,.1));border-color:rgba(200,240,255,.4)}
.top{background:linear-gradient(135deg,rgba(255,255,255,.66),rgba(214,240,255,.38));-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);border:1px solid rgba(255,255,255,.8);box-shadow:0 8px 28px rgba(40,100,180,.16),inset 0 1px 0 rgba(255,255,255,.95)}
.top .gs input{background:rgba(255,255,255,.55);border-color:rgba(255,255,255,.9)}
.card,.hero{background:linear-gradient(135deg,rgba(255,255,255,.62),rgba(255,255,255,.28) 48%,rgba(255,255,255,.46));-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);border:1px solid rgba(255,255,255,.78);box-shadow:0 8px 30px rgba(31,90,170,.16),inset 0 1px 0 rgba(255,255,255,.95),inset 0 0 0 1px rgba(255,255,255,.18)}
.hero{background:linear-gradient(120deg,rgba(255,255,255,.62),rgba(190,228,250,.36))}
.card:hover{box-shadow:0 12px 36px rgba(31,110,210,.22),0 0 20px rgba(90,200,255,.22),inset 0 1px 0 rgba(255,255,255,.95)}
.card>h2{background:linear-gradient(100deg,rgba(11,86,176,.86),rgba(21,150,214,.76) 58%,rgba(64,219,224,.7));-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.55);text-shadow:0 1px 3px rgba(0,40,100,.35)}
.card input,.card select,.card textarea,.modal input,.modal select{background:rgba(255,255,255,.58);border:1px solid rgba(255,255,255,.9);box-shadow:inset 0 1px 3px rgba(31,90,170,.1);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.card input[readonly]{background:rgba(214,230,248,.6)}
th{background:rgba(214,234,252,.6)}
th,td{border-color:rgba(160,195,235,.45)}
.tbl tbody tr td{background:rgba(255,255,255,.3)}
.tbl tbody tr:nth-child(even) td{background:rgba(120,180,240,.14)}
.detail,.tbl tbody tr:nth-child(even) td.detail{background:rgba(255,255,255,.52)}
.ghost,.bar>button:not(.pri),.vact button:not(.pri),.acts button:not(.pri),.actions .l,.abtn .cx{background:rgba(255,255,255,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.item,.hist{background:rgba(255,255,255,.42);border-color:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.bpbox{background:rgba(232,245,255,.5);border-color:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.nt{background:rgba(255,255,255,.52);border-color:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.nt.un{background:rgba(206,232,255,.66);border-color:rgba(110,175,240,.85)}
.info{background:linear-gradient(135deg,rgba(227,241,253,.66),rgba(214,236,251,.44));border-color:rgba(255,255,255,.8)}
.sum .gt{background:linear-gradient(135deg,rgba(190,225,252,.72),rgba(170,215,250,.5))}
.umenu{background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);border-color:rgba(255,255,255,.9)}
.mfil{background:rgba(255,255,255,.58);border-color:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.modal{background:rgba(10,30,70,.5);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.modal .viewer{background:rgba(255,255,255,.8);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.9);box-shadow:0 20px 60px rgba(10,30,70,.4),inset 0 1px 0 rgba(255,255,255,.95)}
.vpaper{background:rgba(207,214,224,.55);border-color:rgba(255,255,255,.8)}
#toast{background:rgba(18,36,66,.8);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.28);border-radius:12px;box-shadow:0 8px 28px rgba(10,30,70,.35)}
@media(prefers-reduced-motion:reduce){.card:hover{transition:none}}
/* ---- Form Buat PO: layout rapat tanpa ruang kosong & ukuran diperkecil ---- */
.two .card{margin-bottom:12px;border-radius:16px;container-type:inline-size}
.two .card>h2{height:40px;padding:0 16px;gap:9px;font-size:14.5px}
.two .card>h2 svg{width:18px;height:18px}
.two .card .body{padding:12px 14px}
.two label{font-size:12px;margin-bottom:3px}
.two .card .fld{margin-bottom:0}
.two input,.two select,.two textarea{min-height:34px;padding:6px 10px;font-size:13px;border-radius:9px}
.two .ifld input,.two .ifld textarea,.two .ifld select{padding-left:32px}
.two .ifld .ico{left:9px;top:8px}.two .ifld .ico svg{width:16px;height:16px}
.two .gi,.two .grid,.two .grid3{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px 12px;align-items:start}
.two .gi .fld:nth-child(2){grid-column:span 2} /* Alamat: 2 kolom -> baris 1 = Nama, Alamat, Email; baris 2 = NPWP, Fax, PIC, Telepon */
.two .body>div[style*="margin-bottom"]{margin-bottom:8px!important}
.two .body>p{margin:6px 0 0}
.two .item{padding:8px 10px;margin-bottom:8px;border-radius:12px;container-type:inline-size}
.two .ihead{margin-bottom:4px}.two .ihead button{padding:2px 8px}
.two .exs{margin:0 0 6px;gap:5px}.two .exs button{padding:0 9px;font-size:11.5px}
.two .r1{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 10px;margin:0;align-items:start}
.two .r1>.fld:first-child{grid-column:1/-1}
.two .r2{display:contents}
.two .pri,.two .actions button{padding:7px 14px;font-size:13px;border-radius:10px}
.two .actions{margin-top:4px}
@container (max-width:620px){
  .two .gi,.two .grid,.two .grid3{grid-template-columns:repeat(2,minmax(0,1fr))}
  .two .gi .fld:nth-child(2){grid-column:auto}
  .two .gi .fld:nth-child(7){grid-column:1/-1}
}
@container (max-width:380px){
  .two .gi,.two .grid,.two .grid3{grid-template-columns:1fr}
  .two .gi .fld:nth-child(7){grid-column:auto}
}
@container (max-width:460px){
  .two .r1{grid-template-columns:repeat(2,minmax(0,1fr))}
}
.two{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:14px}
.two>div>.card:last-child{margin-bottom:0}
.two .hist{margin-top:6px}.two .hhead{padding:6px 10px}.two .hi{width:34px;height:34px;border-radius:10px}.two .hi svg{width:18px;height:18px}
.two .hhead .ht b{font-size:13px}.two .hhead small{font-size:11.5px}
.two .kvi>div{padding:5px 2px}.two .sum>div{padding:6px 4px}.two .sum .gt{padding:8px 12px;font-size:15px}.two .sum .gt span:last-child{font-size:19px}
.two .info{padding:8px 10px;margin-bottom:8px}
.two .actions{padding-bottom:0}
.two .fold .fhead{padding:10px 14px;font-size:13.5px}
.two .fold textarea{min-height:60px}
@media(max-width:1100px){.two{grid-template-columns:1fr}}
.dpf{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end}.dpf .fld{margin:0}.dpf .acts{padding-bottom:1px}
@media(max-width:700px){.dpf{grid-template-columns:1fr}}

/* ---- Modal Ganti Password: tema login (biru glass, ornamen mewah) ---- */
.pwbox.lux{position:relative;overflow:hidden;width:380px;max-width:92vw;padding:24px 26px 18px;border-radius:22px;color:#fff;
  background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.6),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(120,190,255,.38),transparent 60%),linear-gradient(180deg,rgba(10,58,142,.86) 0%,rgba(11,95,186,.78) 50%,rgba(18,149,214,.72) 100%);
  -webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);
  border:1px solid rgba(255,255,255,.5);
  box-shadow:0 24px 60px rgba(4,16,48,.55),0 0 34px rgba(125,200,255,.35),inset 0 1px 0 rgba(255,255,255,.55),inset 0 0 0 1px rgba(255,255,255,.08)}
.pwbox.lux>*{position:relative;z-index:1}
.pwbox.lux .pworn{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
.pwbox.lux .sheen{position:absolute;top:-20%;bottom:-20%;left:0;width:45%;z-index:2;pointer-events:none;opacity:0;background:linear-gradient(105deg,transparent 0%,rgba(255,255,255,0) 30%,rgba(255,255,255,.45) 50%,rgba(255,255,255,0) 70%,transparent 100%);transform:translateX(-130%) skewX(-18deg);animation:sweep 1.1s ease-in-out .25s both}
.pwhead{text-align:center;margin-bottom:12px}
.pwlock{width:54px;height:54px;margin:0 auto 8px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,rgba(255,255,255,.34),rgba(120,200,255,.16));border:1px solid rgba(220,242,255,.8);box-shadow:0 6px 20px rgba(4,20,70,.45),0 0 0 6px rgba(255,255,255,.07),0 0 0 12px rgba(255,255,255,.04),inset 0 1px 0 rgba(255,255,255,.7)}
.pwbox.lux h3{margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:.3px;text-shadow:0 1px 2px rgba(0,20,60,.5)}
.pwbox.lux .pwhead p{margin:3px 0 0;font-size:12px;color:#e0f1ff}
.pwdiv{display:flex;align-items:center;gap:8px;margin:12px 18px 0}
.pwdiv i{flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(210,238,255,.8),transparent)}
.pwdiv em{width:7px;height:7px;transform:rotate(45deg);background:linear-gradient(135deg,#e9f7ff,#6fc6ff);box-shadow:0 0 10px rgba(150,220,255,.9)}
.pwbox.lux label{color:#fff;font-weight:600;font-size:12px;margin-bottom:3px;text-shadow:0 1px 2px rgba(0,20,60,.45)}
.pwbox.lux .fld{margin-bottom:8px}
.pwbox.lux input:not([type=checkbox]){min-height:36px;padding:7px 12px;font-size:13px;border-radius:10px;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.5);box-shadow:inset 0 1px 3px rgba(0,30,90,.25);-webkit-backdrop-filter:none;backdrop-filter:none}
/* Isian ganti password model embos ke dalam (lubang) yang sama dengan login/daftar */
.pwbox.lux input:not([type=checkbox]){background:rgba(2,18,56,.62);border:1px solid rgba(0,0,0,.45);box-shadow:inset 0 4px 12px rgba(0,0,0,.55),inset 0 -1px 0 rgba(255,255,255,.14)}
.pwbox.lux input:-webkit-autofill{-webkit-text-fill-color:#fff;caret-color:#fff;box-shadow:0 0 0 100px rgba(2,18,56,.95) inset}
.pwbox.lux input:not([type=checkbox]):focus{outline:2px solid rgba(255,255,255,.9);outline-offset:1px;border-color:#d4f0ff}
.pwbox.lux input::placeholder{color:rgba(215,238,255,.7)}
.pwbox.lux .pwshow{display:flex;align-items:center;gap:8px;color:#e8f4ff;font-size:12px;font-weight:500;margin:2px 0 8px}
.pwbox.lux .pwshow input{width:15px;height:15px;min-height:0;padding:0;margin:0;accent-color:#3da0ff}
.pwstr{display:flex;align-items:center;gap:8px;margin-top:5px}
.pwstr .bars{display:flex;gap:4px;flex:1;height:auto;align-items:center}.pwstr .bars i{flex:1;height:4px;border-radius:3px;background:rgba(255,255,255,.22)}
.pwstr .bars i.on{background:#ff7a86}.pwstr .bars i.on.s2{background:#ffc94d}.pwstr .bars i.on.s3{background:#6fe3a8}.pwstr .bars i.on.s4{background:#3fe0c8;box-shadow:0 0 8px rgba(63,224,200,.8)}
.pwstr small{color:#e8f4ff;font-size:11px;min-width:64px;text-align:right}
.pwdesc{font-size:11px;line-height:1.5;margin:2px 0 8px;color:var(--mute)}
.pwbox.lux .pwdesc{color:#e8f4ff}
/* Legenda 4 level model embos ke dalam (lubang): kotak cekung, level aktif dibingkai warnanya */
.pwlegend{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:6px 0 10px;padding:10px;border-radius:14px;background:rgba(3,20,60,.06);box-shadow:inset 0 2px 8px rgba(3,20,60,.18),inset 0 -1px 0 rgba(255,255,255,.6)}
.pwlegend>div{border-radius:10px;padding:8px}
.pwlegend b{display:block;font-size:11px;margin-bottom:3px}
.pwlegend small{display:block;font-size:10px;line-height:1.4;color:var(--mute)}
.pwbox.lux .pwlegend{background:rgba(0,10,35,.35);box-shadow:inset 0 3px 12px rgba(0,0,0,.55),inset 0 -1px 0 rgba(255,255,255,.10)}
.pwbox.lux .pwlegend small{color:#cfe8ff}
.pwerr{margin:0 0 8px;padding:7px 10px;border-radius:10px;font-size:12px;font-weight:600;color:#fff;background:rgba(190,30,50,.5);border:1px solid rgba(255,170,180,.7)}
.pwbox.lux .acts{margin-top:4px;gap:8px}
.pwbox.lux .acts .pri{flex:1;justify-content:center;padding:9px 14px;color:#fff;font-weight:700;background:linear-gradient(90deg,#17a9ee,#40e2ee);border:1px solid rgba(255,255,255,.75);box-shadow:0 0 18px rgba(90,225,255,.55),inset 0 1px 0 rgba(255,255,255,.65)}
.pwbox.lux .acts .pwcancel{padding:9px 16px;color:#fff;font-weight:600;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.45);-webkit-backdrop-filter:none;backdrop-filter:none}
.pwbox.lux .acts button:hover{filter:brightness(1.12)}
.thm .thact{display:flex;gap:6px;align-items:center;margin-top:2px}
.thm .thact button{padding:2px 10px;font-size:11.5px;font-weight:600;line-height:1.4;border-radius:9px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
.thm .thact .back{color:#0b3a8e;background:#fff;border:1px solid #fff}
.thm .thact .back:disabled{opacity:.45;color:#0b3a8e}
.thm .thact .ghost:disabled{opacity:.45}
/* ---- Font: judul Plus Jakarta Sans, isi Inter, halaman login Poppins ---- */
.hero h1,.card>h2,.ttl b,.dh h3,.tl1 b,.drill .drttl b,.pwbox.lux h3,.thm b,.pwbox h3{font-family:"Plus Jakarta Sans",Inter,"Segoe UI",system-ui,sans-serif;letter-spacing:-.01em}
.hero h1{font-weight:800;font-size:21px;letter-spacing:-.015em}
.card>h2{font-weight:700;font-size:16.5px}
.auth,.auth input,.auth select,.auth button,.auth label{font-family:Poppins,Inter,"Segoe UI",system-ui,sans-serif}
.auth .face h1{font-family:Poppins,Inter,sans-serif;font-weight:700;letter-spacing:.2px}
/* Foto background login ikut berwarna sesuai tema admin (lapisan warna, luminositas foto tetap) */
.authtint{position:absolute;inset:0;z-index:1;pointer-events:none;mix-blend-mode:color;opacity:.7;background:linear-gradient(135deg,#0a3a8e,#1b6fd1 50%,#40e2ee)}

/* ---- Dashboard: glass berlapis seperti desain referensi ---- */
.dash .dhead{display:flex;align-items:center;gap:14px;margin:2px 0 14px;flex-wrap:wrap}
.dhic{width:50px;height:50px;border-radius:14px;display:grid;place-items:center;color:#1e6fd0;background:linear-gradient(145deg,rgba(255,255,255,.9),rgba(170,210,250,.65));border:1px solid rgba(255,255,255,.9);box-shadow:0 8px 20px rgba(31,90,170,.22),inset 0 1px 0 #fff}
.dht{flex:1;min-width:220px}
.dht h2{margin:0;font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:25px;font-weight:800;letter-spacing:-.02em;color:#0d2a57;line-height:1.1}
.dht p{margin:3px 0 0;color:#40587f;font-size:13px}
.dper,.dupd{display:flex;align-items:center;gap:8px;height:42px;padding:0 14px;border-radius:14px;color:#27487c;font-weight:600;font-size:13px;margin:0;
  background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(255,255,255,.4));-webkit-backdrop-filter:blur(14px) saturate(1.5);backdrop-filter:blur(14px) saturate(1.5);border:1px solid rgba(255,255,255,.9);box-shadow:0 6px 18px rgba(31,90,170,.14),inset 0 1px 0 #fff}
.dper select{border:0;background:transparent;min-height:0;height:30px;width:auto;padding:0 2px;appearance:none;-webkit-appearance:none;font-weight:700;font-size:13px;color:#12315f;cursor:pointer;box-shadow:none}
.dper select:focus{outline:none}
.dper .dsel{display:flex;align-items:center;gap:4px;margin:0;padding:0 0 0 10px;border-left:1px solid rgba(39,72,124,.18)}
.dper .dsel:first-of-type{border-left:0;padding-left:0}
.dupd{gap:10px}.dupd small{display:block;font-size:10.5px;color:var(--mute);font-weight:500;line-height:1.1}.dupd b{display:block;font-size:12.5px;color:#12315f;line-height:1.2}
.dash .kpi{overflow:hidden;border-radius:22px;padding:16px 16px;min-height:104px;border:1px solid rgba(255,255,255,.85);
  box-shadow:0 12px 30px rgba(31,90,170,.2),inset 0 1px 0 rgba(255,255,255,.9),inset 0 0 0 1px rgba(255,255,255,.2)}
.dash .kpi::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(125deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.12) 38%,rgba(255,255,255,0) 60%)}
.dash .kpi .kb,.dash .kpi .kic{position:relative;z-index:1}
.dash .kic{width:48px;height:48px;border-radius:50%!important;border:1.5px solid rgba(255,255,255,.85);box-shadow:0 6px 16px rgba(20,60,130,.3),0 0 0 5px rgba(255,255,255,.18),inset 0 1px 0 rgba(255,255,255,.7)}
.dash .kb small{font-weight:600;font-size:12.5px;color:#27406a}
.dash .kb b{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-weight:800;color:#0d2a57}
.kbars{position:absolute;right:14px;bottom:12px;display:flex;align-items:flex-end;gap:4px;z-index:0}
.kbars i{display:block;width:8px;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,var(--kc,rgba(255,255,255,.55)),rgba(255,255,255,.15))}
.kbars i:nth-child(1){height:14px}.kbars i:nth-child(2){height:22px}.kbars i:nth-child(3){height:31px}.kbars i:nth-child(4){height:42px}
.dash .k1{--kc:rgba(255,255,255,.7);background:linear-gradient(135deg,rgba(20,100,225,.92),rgba(70,160,250,.7))}
.dash .k1 .kb small,.dash .k1 .kb b,.dash .k1 .kd span{color:#fff}.dash .k1 .kic{background:rgba(255,255,255,.2)!important}
.dash .k1 .kd em.good{color:#9dffc8}.dash .k1 .kd em.bad{color:#ffc0c6}
.dash .k2{--kc:rgba(240,150,20,.7);background:linear-gradient(135deg,rgba(255,196,80,.62),rgba(255,235,200,.45))}
.dash .k3{--kc:rgba(22,162,99,.6);background:linear-gradient(135deg,rgba(80,215,150,.55),rgba(215,250,232,.45))}
.dash .k4{--kc:rgba(224,53,70,.55);background:linear-gradient(135deg,rgba(255,130,142,.55),rgba(255,222,226,.45))}
.dash .k5{--kc:rgba(125,90,235,.6);background:linear-gradient(135deg,rgba(190,170,255,.58),rgba(236,230,255,.48))}
.dash .dcard{border-radius:22px;border:1px solid rgba(255,255,255,.85);
  background:linear-gradient(135deg,rgba(255,255,255,.6),rgba(255,255,255,.22) 50%,rgba(255,255,255,.4));
  box-shadow:0 12px 32px rgba(31,90,170,.16),inset 0 1px 0 rgba(255,255,255,.95),inset 0 0 0 1px rgba(255,255,255,.2)}
.dash .dcard>.dh{position:relative;z-index:1}
.dash .dcard::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(125deg,rgba(255,255,255,.4) 0%,rgba(255,255,255,0) 42%)}
.dash .dic{width:32px;height:32px;border-radius:50%;color:#1e6fd0;background:linear-gradient(145deg,#fff,rgba(176,213,250,.85));border:1px solid rgba(255,255,255,.95);box-shadow:0 3px 10px rgba(40,100,180,.28),0 0 0 4px rgba(255,255,255,.25)}
.dash .dh h3{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:14.5px;font-weight:700}
.dash .dcard .tbl{border-radius:14px;border:1px solid rgba(255,255,255,.8);overflow:auto;background:rgba(255,255,255,.28)}
.dash .dcard .dtbl{border-collapse:separate;border-spacing:0}
.dash .dcard .dtbl th{background:linear-gradient(180deg,rgba(60,130,230,.34),rgba(120,180,245,.24));color:#0d2a57;font-weight:700;border-color:rgba(255,255,255,.7)}
.dash .dcard .dtbl td{border-color:rgba(255,255,255,.7)}
.dash .dcard .tbl tbody tr:nth-child(odd) td{background:rgba(255,255,255,.5)}
.dash .dcard .tbl tbody tr:nth-child(even) td{background:rgba(190,220,250,.32)}
.dpn{display:inline-flex;align-items:center;gap:8px}
.dpi{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#3a96ee,#1a62c8);box-shadow:0 2px 8px rgba(30,90,170,.35);flex:none}
.rk{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;margin-right:7px;font-size:11px;font-weight:800;color:#fff;background:linear-gradient(145deg,#3a96ee,#1a62c8);box-shadow:0 2px 6px rgba(30,90,170,.35);vertical-align:middle}
.rk.g1{background:linear-gradient(145deg,#ffd45e,#f0a014)}.rk.g2{background:linear-gradient(145deg,#9fb6d4,#6d86aa)}.rk.g3{background:linear-gradient(145deg,#e8a874,#c0743a)}
.dash .ell{max-width:190px}
.trend .tt3{font-size:9.5px;font-weight:700;fill:#12315f}
.dash .cseg button{border-radius:999px;padding:2px 16px}
.dash .cb{height:11px;background:rgba(255,255,255,.55);box-shadow:inset 0 1px 2px rgba(31,90,170,.15)}
.dash .donut{width:150px;height:150px}
/* ---- Dashboard: Tren Nilai PO & Status Pengajuan PO (efek kaca pada chart) ---- */
.dtop{grid-template-columns:minmax(0,1.18fr) minmax(0,1fr)}
.dash .dh.big{padding:16px 18px 4px;gap:14px;align-items:center}
.dash .dh.big .dic{width:52px;height:52px;border-radius:16px;color:#1d63d6;background:linear-gradient(145deg,#fff,rgba(176,213,250,.9));box-shadow:0 6px 16px rgba(40,100,180,.28),inset 0 1px 0 #fff,0 0 0 5px rgba(255,255,255,.28)}
.dht2{min-width:0}.dht2 h3{margin:0}
.dash .dh.big h3{font-size:clamp(17px,1.7vw,23px);font-weight:800;line-height:1.15}
.dht2 p{margin:3px 0 0;font-size:12.5px;color:var(--mute)}
.dh.big+.db{padding:8px 18px 18px}
.lg2{display:flex;gap:18px;font-size:11.5px;color:#34496b;text-align:left}
.lg2>span{display:flex;align-items:center;gap:7px;line-height:1.2}
.lg2 em{font-style:normal;font-weight:600}
.lg2 em small{display:block;color:var(--mute);font-weight:500;font-size:10.5px}
.lg2 i{display:inline-block;width:18px;height:12px;border-radius:4px;background:linear-gradient(180deg,#cfe4ff,#9cc6f7);border:1px solid rgba(255,255,255,.9);flex:none}
.lg2 i.ln{width:22px;height:2px;border:0;border-radius:2px;background:#1b4fbf;position:relative;overflow:visible}
.lg2 i.ln::after{content:"";position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:#1b4fbf;border:2px solid #fff;box-sizing:border-box}
.trend .ax{font-size:10px;fill:#5b6f90}.trend .axt{font-size:10.5px;font-weight:600;fill:#4d6285}
.trend .bv{font-size:10px;font-weight:700}.trend .tt3{font-size:11px;font-weight:800;fill:#12315f}
.trend .tshine{transform-box:fill-box;animation:tshine 7s 1.4s ease-in-out infinite}
@keyframes tshine{0%,45%{transform:translateX(0) skewX(-18deg);opacity:0}52%{opacity:1}100%{transform:translateX(900px) skewX(-18deg);opacity:0}}
.tstats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) minmax(0,1.3fr);margin-top:10px;border-radius:18px;border:1px solid rgba(255,255,255,.9);background:linear-gradient(135deg,rgba(255,255,255,.72),rgba(255,255,255,.3));box-shadow:inset 0 1px 0 #fff,0 4px 14px rgba(31,90,170,.08)}
.ts{padding:12px 16px;border-right:1px solid rgba(150,190,235,.4);min-width:0}
.ts:last-child{border-right:0}
.ts .tl{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#4d6285;font-weight:600}
.ts .tl i{display:block;width:22px;height:4px;border-radius:2px;flex:none;background:repeating-linear-gradient(90deg,var(--c) 0 6px,transparent 6px 9px)}
.ts b{display:block;font-size:clamp(15px,1.45vw,21px);font-weight:800;color:#0d2a57;margin:5px 0 1px;font-family:"Plus Jakarta Sans",Inter,sans-serif;white-space:nowrap}
.ts small{font-size:11.5px;color:var(--mute)}
.ts.tot{display:flex;align-items:center;gap:10px}
.tico{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#1d63d6;background:linear-gradient(145deg,#fff,rgba(176,213,250,.85));box-shadow:0 3px 10px rgba(40,100,180,.22);flex:none}
.ts .tb{display:block;min-width:0}.ts .tl2{display:block;font-size:12.5px;color:#4d6285;font-weight:600}
.trfoot{display:flex;align-items:center;gap:9px;margin-top:10px;font-size:12px;color:#4d6285}
.trfoot .ic{color:#1d63d6;flex:none}.trfoot b{color:#0f3d8f}
.ppill{position:relative;display:inline-flex;align-items:center;gap:9px;height:40px;padding:0 14px;border-radius:14px;background:linear-gradient(135deg,#fff,rgba(235,244,255,.8));border:1px solid rgba(255,255,255,.95);box-shadow:0 4px 12px rgba(31,90,170,.14);color:#12315f;font-weight:600;font-size:13px;white-space:nowrap}
.ppill select{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.stwrap{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:8px;align-items:center}
.donut2{width:100%;height:auto;max-width:300px;display:block;margin:0 auto;filter:drop-shadow(0 10px 16px rgba(30,90,170,.2))}
.donut2 .dn{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:40px;font-weight:800;fill:#0d2a57;text-anchor:middle}
.donut2 .dl{font-size:14px;fill:#5b6f90;text-anchor:middle}
.donut2 .dp{font-size:13px;font-weight:800}.donut2 .dq{font-size:10.5px;fill:#5b6f90}
.donut2 .dspin{transform-origin:150px 140px;animation:dspin 9s linear infinite}
@keyframes dspin{to{transform:rotate(360deg)}}
.stleg{list-style:none;margin:0;padding:4px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.9);background:linear-gradient(135deg,rgba(255,255,255,.74),rgba(255,255,255,.34));box-shadow:inset 0 1px 0 #fff,0 6px 18px rgba(31,90,170,.1)}
.stleg li{display:grid;grid-template-columns:14px minmax(0,1fr) auto 40px;gap:10px;align-items:center;padding:11px 0}
.stleg li+li{border-top:1px solid rgba(150,190,235,.35)}
.stleg .dot{width:14px;height:14px;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.18),inset 0 1px 1px rgba(255,255,255,.7)}
.stleg .lt b{display:block;font-size:15px;color:#0d2a57;font-weight:700}
.stleg .lt small{display:block;font-size:11px;color:var(--mute);line-height:1.25;margin-top:2px}
.stleg .lv{text-align:right}.stleg .lv b{display:block;font-size:19px;font-weight:800;color:#0d2a57;line-height:1.1}
.stleg .lv small{font-size:12px;color:var(--mute)}
.stleg .lic{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.95);box-shadow:0 3px 8px rgba(31,90,170,.12)}
.sinfo{margin-top:12px;padding:12px 14px 14px;border-radius:20px;border:1px solid rgba(255,255,255,.9);background:linear-gradient(135deg,rgba(255,255,255,.68),rgba(255,255,255,.28));box-shadow:inset 0 1px 0 #fff,0 6px 18px rgba(31,90,170,.08)}
.sinfo h4{display:flex;align-items:center;gap:9px;margin:0 0 10px;font-size:14px;color:#0d2a57}
.sinfo h4 span{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#1d63d6;background:linear-gradient(145deg,#fff,rgba(176,213,250,.85));box-shadow:0 2px 6px rgba(40,100,180,.2)}
.sgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.sc{padding:2px 12px;border-right:1px solid rgba(150,190,235,.4);min-width:0}
.sc:first-child{padding-left:0}.sc:last-child{border-right:0;padding-right:0}
.sc .sh{display:flex;align-items:center;gap:8px;font-size:12px;color:#4d6285;font-weight:600;line-height:1.2}
.sc .si{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;color:#1d63d6;background:linear-gradient(145deg,#fff,rgba(176,213,250,.85));box-shadow:0 3px 8px rgba(40,100,180,.2);flex:none}
.sc b{display:block;margin:8px 0 4px;font-size:clamp(15px,1.4vw,20px);font-weight:800;color:#0d2a57;font-family:"Plus Jakarta Sans",Inter,sans-serif;white-space:nowrap}
.sc small{display:block;font-size:11px;color:var(--mute)}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:7px;font-size:11.5px;font-weight:700;font-style:normal;margin-right:6px}
.chip.good{color:#12a05c;background:rgba(34,181,115,.16)}.chip.bad{color:#e03546;background:rgba(239,74,90,.14)}.chip.flat{color:#6b7c95;background:rgba(120,140,170,.16)}
.pgb{display:block;height:9px;border-radius:6px;background:rgba(255,255,255,.7);box-shadow:inset 0 1px 2px rgba(31,90,170,.18);overflow:hidden;margin:2px 0 6px}
.pgb i{display:block;height:100%;border-radius:6px;box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
.ccols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:34px}
@media(max-width:1150px){.dtop{grid-template-columns:1fr}}
@media(max-width:900px){.ccols{grid-template-columns:1fr}.tstats{grid-template-columns:1fr 1fr}.ts{border-bottom:1px solid rgba(150,190,235,.4)}.ts:nth-child(2n){border-right:0}.ts:nth-last-child(-n+2){border-bottom:0}}
@media(max-width:620px){.stwrap{grid-template-columns:1fr}.sgrid{grid-template-columns:1fr}.sc,.sc:first-child,.sc:last-child{border-right:0;padding:8px 0;border-bottom:1px solid rgba(150,190,235,.4)}.sc:last-child{border-bottom:0}.dash .dh.big{flex-wrap:wrap}.dash .dh.big .dr{margin-left:0;flex:1 1 100%}}
@media(prefers-reduced-motion:reduce){.trend .tshine,.donut2 .dspin{animation:none}.trend .tshine{opacity:0}}
@media(max-width:700px){.dht h2{font-size:20px}}
/* ---- Verifikasi User: kolom password simetris & tombol keterangan rapi ---- */
/* Tabel Verifikasi User: ringkas agar muat satu layar tanpa scroll ke samping */
.utbl{overflow-x:visible}
.utbl table{width:100%;table-layout:auto}
.utbl td,.utbl th{vertical-align:middle;white-space:normal;overflow-wrap:anywhere;padding:3px 9px;font-size:11px;line-height:1.15}
.utbl th{font-size:10.5px;padding:5px 9px}
.utbl td:nth-child(3),.utbl td:nth-child(5),.utbl td:nth-child(6),.utbl th:nth-child(3),.utbl th:nth-child(5),.utbl th:nth-child(6){white-space:nowrap}
.utbl .tag{font-size:10px;padding:1px 8px;line-height:1.2}
.utbl .pwcell{display:inline-flex;align-items:center;gap:4px}
.utbl .pwcell code{display:inline-block;box-sizing:border-box;width:80px;height:17px;line-height:17px;padding:0 7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;letter-spacing:1px;border-radius:9px}
.utbl .pwcell code,.pwcell code{color:#fff!important;font-weight:600;background:linear-gradient(135deg,#0a3a8e,#0b5fba 55%,#1295d6)!important;border:1px solid rgba(255,255,255,.55);box-shadow:0 2px 8px rgba(10,60,140,.3),inset 0 1px 0 rgba(255,255,255,.35);text-shadow:0 1px 1px rgba(0,20,70,.45)}
.utbl .pwcell .pweye{width:18px;height:18px;min-width:18px;padding:0;margin:0;display:inline-grid;place-items:center;border-radius:9px;color:#0f5fc0;background:linear-gradient(145deg,#fff,rgba(200,225,252,.85));border:1px solid rgba(15,95,192,.35);box-shadow:0 2px 6px rgba(30,90,170,.18),inset 0 1px 0 #fff;transition:transform .15s,box-shadow .2s,background .2s}
.utbl .pwcell code[title^="Password sementara"]{width:auto;min-width:80px;max-width:170px;font-size:11px;letter-spacing:.5px;user-select:all}
.utbl .pwcell .pwreset{height:18px;padding:0 9px;font-size:10px;font-weight:700;line-height:1;border-radius:9px;color:#0f5fc0;background:linear-gradient(145deg,#fff,rgba(200,225,252,.85));border:1px solid rgba(15,95,192,.35);box-shadow:0 2px 6px rgba(30,90,170,.18),inset 0 1px 0 #fff;cursor:pointer;transition:transform .15s,box-shadow .2s,background .2s}
.utbl .pwcell .pwreset:hover:not(:disabled){transform:translateY(-1px);background:linear-gradient(135deg,#1e7fe0,#0f5fc0);color:#fff}
.utbl .pwcell .pwreset:disabled{opacity:.4;cursor:not-allowed}
.utbl .pwcell .pweye:disabled{opacity:.4;cursor:not-allowed}
.utbl .pwcell .pweye:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(30,90,170,.3);background:linear-gradient(135deg,#1e7fe0,#0f5fc0);color:#fff}
.auth .face .eye{display:grid;place-items:center;padding:4px 7px}
.utbl .actsel{height:18px;min-height:0;width:140px;max-width:100%;padding:0 20px 0 9px;border-radius:9px;font-size:10.5px;font-weight:700;cursor:pointer}.utbl .actsel:disabled{opacity:.55;cursor:not-allowed}
.utbl .uact{display:flex;gap:6px;flex-wrap:nowrap}
.utbl .uact button{width:96px;height:20px;padding:0 6px;justify-content:center;font-size:12px;font-weight:600;border-radius:14px}
/* tabel kompak: Kategori Barang/Jasa & Data Supplier */
.tbl.ctbl th,.tbl.ctbl td{padding:3px 10px;font-size:11.5px;line-height:1.2}
.tbl.ctbl th{font-size:11px;padding:5px 10px}
.tbl.ctbl .tag{font-size:10.5px;padding:1px 9px;line-height:1.25}
.tbl.ctbl td:nth-child(2),.tbl.ctbl td:nth-child(4),.tbl.ctbl td:nth-child(5){min-width:150px}
.tbl.ctbl .acts.sm button{padding:0 10px;font-size:11px;line-height:1.35;min-width:66px;height:20px}
.tbl .bpt td,.tbl .bpt th{padding:3px 10px;line-height:1.2}
.tbl .bpt th{font-size:11px;padding:5px 10px}
.tbl .bpt td{font-size:12px}.bpt td:first-child b{font-size:12px}
.tbl .bpt .bpst{font-size:11.5px;gap:5px}.bpt .bpst i{width:6px;height:6px}
.tbl .bpt .acts.sm button{padding:0 10px;font-size:11px;line-height:1.35;min-width:66px;height:20px}
.bpt .actsel{height:20px;min-height:0;width:140px;max-width:100%;padding:0 20px 0 9px;border-radius:9px;font-size:11px;font-weight:700;cursor:pointer}
.thmw{position:relative;display:flex;align-items:center}
.thm{position:absolute;right:-8px;top:40px;z-index:21;width:268px;padding:14px;border-radius:16px;display:flex;flex-direction:column;gap:8px;color:#fff;
  background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.55),transparent 62%),linear-gradient(180deg,rgba(10,58,142,.9),rgba(11,95,186,.84) 55%,rgba(18,149,214,.8));
  -webkit-backdrop-filter:blur(20px) saturate(1.6);backdrop-filter:blur(20px) saturate(1.6);border:1px solid rgba(255,255,255,.5);box-shadow:0 18px 44px rgba(5,30,90,.45),inset 0 1px 0 rgba(255,255,255,.5)}
.thm b{font-size:14px}.thm p{margin:0;color:#e0f1ff;font-size:11.5px}.thm label{color:#fff;font-size:12px;margin:2px 0 0}
.thm .sw{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:2px 0}
.thm .sw button{height:34px;padding:0;border-radius:10px;border:2px solid rgba(255,255,255,.45);box-shadow:0 2px 8px rgba(0,20,70,.35);transition:transform .2s}
.thm .sw button:hover{transform:translateY(-2px)}
.thm .sw button.on{border-color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.55),0 0 14px rgba(255,255,255,.6)}
.thm input[type=range]{padding:0;min-height:0;accent-color:#fff}
.thm .ghost{align-self:flex-start;color:#fff;border-color:rgba(255,255,255,.6);background:rgba(255,255,255,.14)}
.pwfoot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:12px;padding-top:9px;border-top:1px solid rgba(190,230,255,.28);font-size:10.5px;letter-spacing:.4px;color:#cfe8ff}
@media(prefers-reduced-motion:reduce){.pwbox.lux .sheen{animation:none}}


/* ---- Halaman Semua Pengajuan (admin) ---- */
.ap-filter{border-radius:22px;margin-bottom:14px}
.apf{display:grid;grid-template-columns:minmax(260px,1.6fr) minmax(150px,1fr) minmax(130px,.9fr) minmax(130px,.9fr) auto;gap:14px;align-items:end;padding:16px 18px}
.apf-f{min-width:0}
.apf-f label{display:block;font-weight:700;font-size:13px;color:#0d2a57;margin-bottom:6px}
.apf-f select{min-height:42px;padding:8px 12px;font-size:13.5px}
.ap-range{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 12px;border-radius:12px;background:rgba(255,255,255,.58);border:1px solid rgba(255,255,255,.9);box-shadow:inset 0 1px 3px rgba(31,90,170,.1);color:#27406a;font-size:13.5px;white-space:nowrap}
.ap-range .ic{flex:none;color:#4a5f86}
.ap-range .ic:last-child{margin-left:auto}
.ap-date{position:relative;cursor:pointer;margin:0;font-weight:500}
.ap-date input{position:absolute;inset:0;width:100%;height:100%;min-height:0;padding:0;border:0;opacity:0;cursor:pointer}
.apf-btns{display:flex;gap:10px}
.apf-btns button{min-height:42px;padding:0 16px;border-radius:10px;font-size:13.5px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:7px;cursor:pointer}
.ap-reset{background:rgba(255,255,255,.7);border:1px solid #9db7e8;color:#1f47b8;font-weight:600}
.ap-kpi{min-width:0;gap:12px}
.ap-kic{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;flex:none;background:linear-gradient(145deg,#eef2ff,#d9e4ff);color:#3157d5;box-shadow:inset 0 1px 0 #fff,0 4px 10px rgba(49,87,213,.15);position:relative;z-index:1}
.ap-kic .rpc{width:26px;height:26px;border-radius:50%;border:1.8px solid currentColor;display:grid;place-items:center;font-size:11px;font-weight:800}
.ap-kb{min-width:0;display:flex;flex-direction:column;gap:3px;position:relative;z-index:1}
.ap-kb small{font-size:12px;font-weight:600;color:#27406a;white-space:nowrap}
.ap-kv{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ap-kv b{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:24px;line-height:1.1;font-weight:800;color:#0d2a57}
.ap-kv b.sm{font-size:17px}
.ap-bdg{font-style:normal;font-size:11px;font-weight:700;padding:2px 10px;border-radius:999px}
.ap-bdg.b{background:#dbe7ff;color:#2f5bd6}.ap-bdg.y{background:#fff0c2;color:#8a5b00}
.ap-dl{font-style:normal;font-size:11.5px;font-weight:700}
.ap-dl.good{color:#16a263}.ap-dl.bad{color:#e03546}.ap-dl.flat{color:#6b7c99}
.ap-ks{font-size:10.5px;color:#5b6f8c;white-space:nowrap}
.ap-row{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)}
@media(max-width:1000px){.ap-row{grid-template-columns:minmax(0,1fr)}.apf{grid-template-columns:repeat(2,minmax(0,1fr))}.apf-btns{grid-column:1/-1}}
.ap-chart{position:relative;padding:8px 6px 4px 20px}
.ap-yt{position:absolute;left:0;top:8px;height:190px;display:flex;align-items:center;justify-content:center;writing-mode:vertical-rl;transform:rotate(180deg);font-size:10.5px;color:#5b6f8c;white-space:nowrap}
.ap-plot{display:grid;grid-template-columns:30px minmax(0,1fr);height:190px;padding-top:6px}
.ap-yax{display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding-right:8px;margin:-6px 0;font-size:11px;line-height:12px;color:#4a5f86}
.ap-area{position:relative;border-left:1px solid #c3d2ea}
.ap-grid{position:absolute;left:0;right:0;height:0;border-top:1px dashed rgba(120,150,200,.35)}
.ap-bars{position:absolute;inset:0;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:end;padding:0 4px}
.ap-col{height:100%;display:flex;align-items:flex-end;justify-content:center}
.ap-col i{display:block;width:min(54%,46px);border-radius:4px 4px 0 0;position:relative;transform-origin:bottom;animation:apgrow .7s cubic-bezier(.2,.8,.2,1) both}
.ap-col i b{position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:3px;font-size:12px;font-weight:700;color:#0d2a57}
@keyframes apgrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
.ap-xl{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin-left:30px;padding:6px 4px 0;font-size:11px;color:#27406a;text-align:center}
.ap-xl span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px}
.ap-top{font-size:13px;margin-top:2px}
.ap-th,.ap-tr{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.5fr) 24px;gap:12px;align-items:center;padding:8px 12px}
.ap-th{background:rgba(214,226,248,.75);border-top:1px solid #cfdbef;border-bottom:1px solid #cfdbef;font-weight:700;color:#0d2a57}
.ap-th span:nth-child(2){grid-column:2/4}
.ap-tr{border-bottom:1px solid rgba(190,205,230,.45);color:#12284a}
.ap-tr .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ap-tr .bt{display:block;height:11px}
.ap-tr .bt i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#3b4fe0,#5b78f2);transform-origin:left;animation:apgrowx .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes apgrowx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.ap-tr .ct{text-align:right;font-weight:700}
.ap-lim{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media(max-width:700px){.ap-lim{grid-template-columns:minmax(0,1fr)}}
.ap-limc{text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:4px;padding:14px 18px;border:2px solid transparent;font:inherit}
.ap-limc small{font-size:12.5px;font-weight:700;color:#27406a}
.ap-limv{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.ap-limv b{font-family:"Plus Jakarta Sans",Inter,sans-serif;font-size:26px;line-height:1.1;font-weight:800;color:#0d2a57}
.ap-limv span{font-size:12px;color:#5b6f8c;font-weight:600}
.ap-limv em{font-style:normal;font-weight:800;font-size:14px;color:#1f47b8;margin-left:auto}
.ap-lims{font-size:11.5px;font-weight:700}
.ap-limc.atas .ap-lims{color:#b42318}.ap-limc.bawah .ap-lims{color:#157347}
.ap-limc.atas.on{border-color:#e0707a}.ap-limc.bawah.on{border-color:#5fbf8b}
.ap-nl{display:inline-block;margin-top:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px}
.ap-nl.big{background:#fde8e8;color:#b42318}.ap-nl.sm{background:#e3f4ea;color:#157347}
.ap-nl-n{font-size:10.5px;font-weight:700;color:#b42318;margin-top:3px;line-height:1.3;max-width:170px;white-space:normal}
.ap-exp{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:10px;border:1px solid #9db7e8;background:rgba(255,255,255,.7);color:#1f47b8;font-weight:600;font-size:13px;cursor:pointer}
.ap-tbl{width:100%;border-collapse:collapse}
.ap-tbl th,.ap-tbl td{padding:9px 10px;font-size:12.5px;text-align:left;vertical-align:middle;border-bottom:1px solid rgba(190,205,230,.5);color:#12284a}
.ap-tbl th{background:rgba(214,226,248,.75);color:#0d2a57;font-weight:700;white-space:nowrap}
.ap-tbl .lnk{font-weight:700;text-decoration:underline;color:#1a47c8;font-size:12.5px;white-space:nowrap}
.ap-tbl td.vd{min-width:130px;max-width:170px}.ap-tbl td.dp{min-width:110px;max-width:150px}.ap-tbl td.tt{white-space:nowrap}
.ap-sort{background:none;border:0;padding:0;font:inherit;font-weight:700;color:inherit;cursor:pointer;display:inline-flex;gap:5px;align-items:center}
.ap-sa{font-size:11px;color:#5b6f8c}
.ap-act{display:flex;gap:8px;align-items:center}
.ap-det{background:linear-gradient(135deg,#2a52e0,#1e3fc0);color:#fff;border:0;border-radius:8px;padding:7px 16px;font-weight:600;font-size:12.5px;cursor:pointer;box-shadow:0 3px 8px rgba(30,63,192,.3)}
.ap-dots{width:34px;height:30px;border-radius:8px;border:1px solid #c5d3ee;background:rgba(255,255,255,.7);color:#27406a;font-weight:800;letter-spacing:1px;cursor:pointer;line-height:1;padding:0}
.ap-mask{position:fixed;inset:0;z-index:70}
.ap-menu{position:fixed;z-index:71;min-width:172px;padding:6px;border-radius:12px;background:#fff;border:1px solid #d3e2f2;box-shadow:0 14px 34px rgba(20,50,110,.25);display:flex;flex-direction:column}
.ap-menu button{text-align:left;background:none;border:0;padding:8px 12px;border-radius:8px;font-size:13px;color:#12284a;cursor:pointer;font-family:inherit}
.ap-menu button:hover{background:#eef4ff}.ap-menu button.cx{color:#b42318}
@media(prefers-reduced-motion:reduce){.ap-col i,.ap-tr .bt i{animation:none}}

/* ---- Nilai KPI mengecil otomatis agar angka penuh; info Supplier BP di tabel Semua Pengajuan ---- */
.kpi>.kb{flex:1 1 0;min-width:0}
.fitg{position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none}
.ap-tbl td.vd{min-width:170px;max-width:230px}
.ap-bp{display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;font-weight:700;line-height:1.3}
.ap-bp i{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.ap-bp.ak{color:#157347}.ap-bp.so{color:#8a5b00}.ap-bp.ex{color:#b42318}.ap-bp.na{color:#6b7c99;font-weight:600}

/* ---- Notifikasi penolakan PO & Kirim Ulang ---- */
.nt.rj{border-color:rgba(224,53,70,.45)}
.nt.rj .nti{background:#fde8e8;color:#b42318}
.ntt small.ntr{display:block;margin-top:3px;color:#b42318;font-weight:600}
.ntact{margin:-2px 0 10px 46px}
.ntact .pri{padding:6px 14px;font-size:12.5px}

/* ---- Tombol Cetak PO user: abu-abu + tooltip sebelum di-approve admin ---- */
.tipw{position:relative;display:inline-flex}
.tipw::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%) translateY(4px);background:#14243d;color:#fff;font-size:12px;font-weight:600;padding:6px 10px;border-radius:8px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:30;box-shadow:0 6px 16px rgba(10,25,60,.3)}
.tipw::before{content:"";position:absolute;bottom:calc(100% + 3px);left:50%;transform:translateX(-50%);border:5px solid transparent;border-top-color:#14243d;border-bottom:0;opacity:0;transition:opacity .15s;z-index:30;pointer-events:none}
.tipw:hover::after,.tipw:focus-within::after{opacity:1;transform:translateX(-50%) translateY(0)}
.tipw:hover::before,.tipw:focus-within::before{opacity:1}
button.off,.ghost.off,.vact button.off{background:#d5dae3!important;color:#7d8798!important;border:1px solid #c3cad6!important;cursor:not-allowed!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}

/* ---- Semua Pengajuan: kartu & filter menyesuaikan ukuran font otomatis ---- */
.fitbox{width:100%;min-width:0;overflow:hidden}
.fitin{width:max-content;white-space:nowrap}
.ap-kb{flex:1 1 0;min-width:0}
.ap-kv{flex-wrap:nowrap;width:max-content}
.ap-kv b.sm{font-size:24px}
.ap-filter{container-type:inline-size}
@media(min-width:1001px){.apf{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr) minmax(0,.9fr) minmax(0,.9fr) auto}}
.apf{gap:clamp(8px,1.1cqw,14px);padding:clamp(10px,1.2cqw,16px) clamp(10px,1.4cqw,18px)}
.apf-f label{font-size:clamp(11px,1.05cqw,13px)}
.apf-f select,.ap-range{font-size:clamp(11px,1.1cqw,13.5px);min-width:0}
.apf-f select{padding-left:clamp(8px,1cqw,12px);padding-right:clamp(6px,.8cqw,10px);text-overflow:ellipsis}
.ap-range{gap:clamp(4px,.6cqw,8px);padding:0 clamp(8px,1cqw,12px)}
.ap-range>span{flex:none}
.apf-btns{gap:clamp(6px,.8cqw,10px)}
.apf-btns button{font-size:clamp(11px,1.1cqw,13.5px);padding:0 clamp(8px,1.1cqw,16px);gap:clamp(4px,.5cqw,7px)}

/* ================= MODE HP & TABLET (Android / iPhone / iPad) =================
   Tablet & HP: sidebar jadi drawer geser (tombol hamburger), form 1 kolom, tabel bisa digeser,
   input 16px (iPhone tidak zoom sendiri saat mengetik), area sentuh min. 40px, aman dari notch/poni. */
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{overflow-x:hidden}
img,svg,video,canvas{max-width:100%}
.burger,.sclose,.navmask{display:none}
button,.nv,.bell,.mebtn{touch-action:manipulation}
@media(max-width:900px){
  body{background-attachment:scroll;min-height:100vh;min-height:100dvh}
  .shell{min-height:100vh;min-height:100dvh}
  .shell::before{display:none}
  /* ---- sidebar = drawer ---- */
  .navmask{display:block;position:fixed;inset:0;z-index:55;background:rgba(6,20,50,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .25s ease}
  .navmask.show{opacity:1;pointer-events:auto}
  .side{position:fixed;top:0;left:0;bottom:0;height:auto;min-height:100vh;min-height:100dvh;width:min(84vw,300px);z-index:58;border-radius:0 24px 0 0;
    padding:calc(14px + env(safe-area-inset-top)) 12px calc(16px + env(safe-area-inset-bottom)) calc(12px + env(safe-area-inset-left));
    overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;
    background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.8),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(80,170,255,.35),transparent 60%),linear-gradient(180deg,#0a3a8e 0%,#0b5fba 50%,#1295d6 100%);
    -webkit-backdrop-filter:none;backdrop-filter:none;
    transform:translateX(-105%);visibility:hidden;transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s linear .3s}
  .side.open{transform:none;visibility:visible;transition:transform .3s cubic-bezier(.2,.8,.2,1),visibility 0s;box-shadow:12px 0 40px rgba(5,25,70,.45)}
  .sclose{display:grid;place-items:center;position:absolute;top:calc(10px + env(safe-area-inset-top));right:10px;width:36px;height:36px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.16);color:#fff}
  .brand{padding-top:26px}
  .navlist{flex-direction:column;flex-wrap:nowrap;gap:4px}
  .nv{width:100%;padding:11px 12px;font-size:14px;min-height:42px}
  .sep{display:block}.nv.grp{display:flex;padding:8px 12px}.sub{display:block}
  .sub .nv{padding:10px 12px 10px 18px;font-size:13.5px}
  .nv:hover>*:not(.bd),.nv:focus-visible>*:not(.bd){transform:none}
  /* ---- konten & topbar ---- */
  .main{padding:calc(8px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left))}
  .top{flex-wrap:wrap;gap:8px;padding:8px 10px;border-radius:16px}
  .burger{display:grid;place-items:center;flex:none;width:40px;height:40px;padding:0;border-radius:12px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.7);color:#12315f}
  .ttl{flex:1;min-width:0}.ttl b,.ttl small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sp{display:none}
  .gs{order:5;flex:1 1 100%;max-width:none;margin:0}
  .top .gs input{height:42px;min-height:42px;padding-left:38px}.top .gs .ico{top:12px}
  .bell{padding:9px;display:grid;place-items:center}
  .me{border-left:0;padding-left:0}.mn,.mebtn>.ic{display:none}.av{width:36px;height:36px}
  .thmw{position:static}
  .thm{position:absolute;left:0;right:0;top:calc(100% + 8px);width:auto;max-height:70vh;overflow-y:auto;z-index:70}
  .umenu{top:46px;min-width:190px}.umenu button{padding:11px 12px;font-size:14px}
  .crumb{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;margin:8px 4px 6px;font-size:12px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .crumb::-webkit-scrollbar{display:none}.crumb>*{flex:none}
  .hero{padding:10px 12px;gap:10px;min-height:56px}.hico{width:40px;height:40px}
  .hero h1{font-size:18px}.hero p{font-size:12px}.wave{width:70%;opacity:.55}
  .card{border-radius:16px;margin-bottom:14px}
  .card>h2{height:auto;min-height:48px;padding:10px 14px;font-size:15.5px;line-height:1.25}
  .body{padding:14px}.pad{padding:12px}
  .fold .fhead{padding:12px 14px}
  /* efek kaca diperingan supaya scroll tetap mulus di HP */
  .card,.hero,.top,.modal .viewer{-webkit-backdrop-filter:blur(8px) saturate(1.2);backdrop-filter:blur(8px) saturate(1.2)}
  /* ---- form & tombol ---- */
  input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{font-size:16px!important;min-height:44px}
  input[type=date],input[type=month],input[type=time],input[type=datetime-local]{display:block;min-width:0;max-width:100%}
  .auth .face input,.auth .face select{min-height:42px}
  .pri,.ghost,.actions button,.acts button,.vact button,.thm .thact button,.tabs button,.hhead{min-height:40px}
  .acts.sm{flex-wrap:wrap}
  .actions{flex-wrap:wrap}.actions button{flex:1 1 140px}.actions .l{margin-right:0;flex-basis:100%}
  .kvi>div{flex-wrap:wrap}.kvi>div>span{width:auto;min-width:120px;white-space:normal}.kvi b{white-space:normal;flex-wrap:wrap}
  .sum .gt{font-size:16px}.sum .gt span:last-child{font-size:20px}
  .bar>select,.bar>input,.bar>.ifld{width:100%;flex:1 1 100%;min-width:0}
  .ifld.grow{min-width:0;flex:1 1 100%}
  .tedit{flex-wrap:wrap}.tedit input{flex:1 1 140px;min-width:0}
  .stats{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.stat{padding:14px}.stat b{font-size:21px}
  /* ---- tabel: geser kiri-kanan dengan jari ---- */
  .tbl{-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;scrollbar-width:thin}
  .tbl table:not(.dtbl){min-width:600px}.tbl table.dtbl{min-width:420px}
  th,td{padding:8px}
  /* ---- dokumen PO / modal ---- */
  .modal{padding:calc(8px + env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))}
  .modal .viewer{padding:12px;border-radius:14px}
  .vbar{align-items:stretch}.vsel,.vinfo{min-width:0;flex:1 1 100%}.vact{width:100%}.vact button{flex:1 1 auto}
  .vpaper{padding:8px}
  .pwbox{margin-top:4vh}
  #toast{bottom:calc(16px + env(safe-area-inset-bottom));z-index:90;width:max-content;max-width:calc(100vw - 24px);text-align:center}
  /* ---- tracking, supplier, detail ---- */
  .trkhead{flex-wrap:wrap}.tl2{align-items:flex-start}.tl li{gap:10px}
  .drill .drstat{grid-template-columns:1fr 1fr}
  .hhead .hi{width:40px;height:40px}
}
@media(max-width:700px){
  /* ---- dashboard ---- */
  .kpis{gap:10px}.kpi:last-child{grid-column:1/-1}
  .dash .kpi{flex-direction:column;align-items:flex-start;gap:8px;padding:12px;min-height:0;border-radius:18px}
  .dash .kic{width:38px;height:38px}
  .kb{width:100%}.kb b{white-space:normal;overflow-wrap:anywhere;font-size:19px}.kpi:last-child .kb b{font-size:20px}
  .dper{height:auto;min-height:42px;flex-wrap:wrap;padding-top:6px;padding-bottom:6px}.dash .dhead{gap:10px}.dht{min-width:0;flex:1 1 100%}.dht h2{font-size:21px}.mfil{margin-left:0}
  .dash .donut{width:128px;height:128px}.dleg li{white-space:normal}
  .dash .ell,.ell{max-width:130px}
  .db{padding:6px 10px 12px}
  .bars{height:180px;gap:6px}
  .crow{grid-template-columns:minmax(60px,1fr) 1.3fr auto}
  .r2{grid-template-columns:1fr 1fr}
  /* ---- login: layar kecil ---- */
  .auth{min-height:100vh;min-height:100dvh;padding:calc(14px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom))}
  .auth .scene{max-width:min(340px,100%)}
  .auth .authbox{padding:20px 18px}
  .auth .orb.o3{display:none}.auth .orb.o1,.auth .orb.o2{width:320px;height:320px}
  .auth::before,.auth::after{width:260px;height:260px}
}
@media(max-width:560px){
  .bpf,.apf{grid-template-columns:1fr}
  .apf-btns{grid-column:auto}
  .r1{grid-template-columns:1fr 1fr}
  .main{padding-left:calc(8px + env(safe-area-inset-left));padding-right:calc(8px + env(safe-area-inset-right))}
  .card>h2{font-size:15px;gap:9px}
  .dh h3{font-size:13.5px}
  .tl li>i{width:26px;height:26px}.tl li::before{left:12px}
}
@media(max-width:360px){
  .kpis{grid-template-columns:1fr}
  .hero h1{font-size:16.5px}.hico{display:none}
  .stats{grid-template-columns:1fr}
}
/* layar HP landscape yang pendek: drawer tetap bisa digulir */
@media(max-height:480px) and (max-width:900px){.side{padding-top:calc(8px + env(safe-area-inset-top))}.brand{padding-top:4px}.sclose{top:6px}}
/* perangkat sentuh: tidak ada efek hover yang "menempel" */
@media(hover:none){.rowlink:hover .drlnk{transform:none}.nv:hover>*:not(.bd){transform:none}}

/* ================= EFEK SIDEBAR: Active Indicator + Partikel Terhubung ================= */
.side{overflow-x:hidden;isolation:isolate}
.brand,.navlist,.sclose{position:relative;z-index:1}
.sclose{position:absolute;z-index:2}
/* Latar partikel terhubung (canvas) */
.sidefx{position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;pointer-events:none;filter:hue-rotate(var(--hd,0deg))}
/* 3) Active Indicator Bar: garis vertikal bersinar di sisi kiri menu aktif (ikut meluncur bersama pill) */
.navpill::before{content:"";position:absolute;left:-9px;top:16%;bottom:16%;width:4px;border-radius:0 5px 5px 0;
  background:linear-gradient(180deg,#ffffff,#7ff3ff 55%,#3fc8ff);
  box-shadow:0 0 8px 1px rgba(160,248,255,.95),0 0 20px 4px rgba(90,225,255,.65);animation:barGlow 2.2s ease-in-out infinite}
@keyframes barGlow{0%,100%{opacity:.85;box-shadow:0 0 8px 1px rgba(160,248,255,.9),0 0 18px 3px rgba(90,225,255,.55)}50%{opacity:1;box-shadow:0 0 12px 2px rgba(190,252,255,1),0 0 28px 7px rgba(90,225,255,.8)}}
@media(max-width:900px){
  /* di HP pill disembunyikan, indikator dipasang langsung di menu aktif */
  .nv.on::before{content:"";position:absolute;left:-12px;top:16%;bottom:16%;width:4px;border-radius:0 5px 5px 0;
    background:linear-gradient(180deg,#ffffff,#7ff3ff 55%,#3fc8ff);box-shadow:0 0 8px 1px rgba(160,248,255,.95),0 0 20px 4px rgba(90,225,255,.65);animation:barGlow 2.2s ease-in-out infinite}
}
@media(prefers-reduced-motion:reduce){.navpill::before,.nv.on::before{animation:none}}
/* ================= SIDEBAR DESKTOP: tertutup = ikon saja, melebar ke kanan saat kursor diarahkan ================= */
.stop{display:contents}
.spanel{display:contents}
@media(min-width:901px){
  .shell{display:block;padding-left:88px;transition:padding-left .32s cubic-bezier(.2,.8,.2,1)}
  .shell.sidehov{padding-left:230px}
  .shell>.side{position:fixed;top:0;left:0;bottom:0;height:100vh;min-height:100vh;min-height:100dvh;width:88px;z-index:40;padding:0;overflow:visible;display:flex;flex-direction:column;
    border:0;border-radius:0;background:none;-webkit-backdrop-filter:none;backdrop-filter:none;box-shadow:none;
    transition:width .32s cubic-bezier(.2,.8,.2,1)}
  .shell>.side.hov{width:230px}
  /* Pengaman: saat mengecil, kolom sidebar sendiri ikut biru sampai bawah (menyatu mulus dengan panel, karena kotak keduanya sama tinggi) */
  .shell>.side:not(.hov){background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.8),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(80,170,255,.35),transparent 60%),linear-gradient(180deg,#0a3a8e 0%,#0b5fba 50%,#1295d6 100%)}
  /* bagian atas: warna sama dengan background dashboard (bukan biru) */
  .shell>.side .stop{display:flex;flex:none;height:98px;align-items:center;justify-content:flex-start;padding:10px 10px 0;overflow:visible;position:relative;z-index:2;
    background:transparent;transition:box-shadow .3s ease}
  /* area logo: polos, ikut warna background dashboard (tanpa bayangan/kotak) */
  .shell>.side .stop,.shell>.side.hov .stop{background:none;box-shadow:none;border:0;-webkit-backdrop-filter:none;backdrop-filter:none}
  .shell>.side .brand{flex:none;width:210px;padding:0 4px}
  .shell>.side .brand b{color:#0d2a57;white-space:nowrap}
  .shell>.side .brand.nobox{background:transparent}
  /* panel biru berisi menu */
  .shell>.side .spanel{display:block;position:relative;flex:1;min-height:0;margin:0;padding:16px 10px 14px;overflow-y:auto;overflow-x:hidden;isolation:isolate;color:#fff;
    border-radius:0 44px 0 0 / 0 64px 0 0;
    background:radial-gradient(120% 55% at 0% 100%,rgba(45,226,230,.8),transparent 62%),radial-gradient(90% 40% at 100% 0%,rgba(80,170,255,.35),transparent 60%),linear-gradient(180deg,#0a3a8e 0%,#0b5fba 50%,#1295d6 100%);
    box-shadow:20px 0 30px -18px rgba(10,60,140,.34);scrollbar-width:none;transition:box-shadow .3s ease}
  .shell>.side .spanel::-webkit-scrollbar{display:none}
  .shell>.side.hov .spanel{box-shadow:24px 0 34px -18px rgba(10,60,140,.42)}
  /* brand (logo + teks) hanya tampil saat sidebar di-hover; saat mengecil, area atas melipat rapat */
  .shell>.side .stop{transition:box-shadow .3s ease,height .32s cubic-bezier(.2,.8,.2,1),padding .32s cubic-bezier(.2,.8,.2,1)}
  .shell>.side .brand{transition:opacity .22s ease}
  .shell>.side:not(.hov) .stop{height:0;padding:0;overflow:hidden}
  .shell>.side:not(.hov) .brand{opacity:0}
  /* lipatan di tepi kanan panel saat sidebar mengecil (tanpa hover) */
  .shell>.side:not(.hov) .spanel::before{content:"";position:absolute;top:0;right:0;width:34px;height:34px;pointer-events:none;z-index:2;
    background:linear-gradient(225deg,transparent 49%,rgba(255,255,255,.55) 50%,rgba(255,255,255,.92) 100%);
    border-radius:0 44px 0 14px;box-shadow:-3px 3px 8px rgba(3,20,60,.35)}
  .shell>.side:not(.hov) .spanel::after{content:"";position:absolute;top:0;right:0;bottom:0;width:30px;pointer-events:none;z-index:0;
    background:linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.20) 45%,rgba(2,18,55,.38) 100%);
    border-radius:0 44px 0 0 / 0 64px 0 0}
  /* menu: teks menyusut saat tertutup, tinggal ikon di tengah */
  .shell>.side .navlist{padding:0;margin-top:0;transition:padding .32s cubic-bezier(.2,.8,.2,1)}
  .shell>.side:not(.hov) .navlist{padding:0 7px}
  .shell>.side .nv>span{overflow:hidden;white-space:nowrap;max-width:190px;opacity:1;
    transition:opacity .22s ease .08s,max-width .32s cubic-bezier(.2,.8,.2,1),transform .25s cubic-bezier(.2,.8,.2,1)}
  .shell>.side:not(.hov) .nv>span{max-width:0;opacity:0;transition-delay:0s}
  .shell>.side .nv{transition:background .25s ease,border-color .25s ease,box-shadow .25s ease,color .25s ease,padding .32s cubic-bezier(.2,.8,.2,1),gap .32s ease}
  .shell>.side:not(.hov) .nv{justify-content:center;gap:0;padding-left:0;padding-right:0}
  .shell>.side:not(.hov) .nv:hover>*:not(.bd){transform:none}
  .shell>.side:not(.hov) .nv.grp{display:none}
  .shell>.side:not(.hov) .nv .bd{position:absolute;top:1px;right:9px;margin:0;min-width:15px;height:15px;font-size:9px;padding:0 3px}
  .shell>.side:not(.hov) .sep{margin:7px 10px}
  /* indikator menu aktif ikut menyempit */
  .shell>.side:not(.hov) .navpill{left:7px;right:7px}
  .shell>.side .navpill.go{transition:transform .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1),left .32s cubic-bezier(.2,.8,.2,1),right .32s cubic-bezier(.2,.8,.2,1)}
}
@media(max-width:900px){
  /* HP/tablet: drawer tetap seperti semula */
  .stop{display:block}
  .spanel{display:block;position:relative;flex:1;min-height:0}
  .stop .brand b{color:#fff}
}
@media(prefers-reduced-motion:reduce){.shell>.side,.shell>.side *{transition:none!important}}

/* ================= LOGIN & DAFTAR: neumorphic "embos ke dalam" (mengikuti gambar referensi) ================= */
.auth .face{border-radius:34px;border:1px solid rgba(150,200,255,.5);padding:26px 24px 24px;
  background:linear-gradient(160deg,rgba(40,100,215,calc(.62*var(--g,1) + .2)),rgba(16,58,150,calc(.55*var(--g,1) + .2)) 55%,rgba(26,84,190,calc(.6*var(--g,1) + .2)));
  box-shadow:0 26px 60px rgba(2,14,48,.55),0 6px 14px rgba(2,14,48,.35),inset 0 2px 2px rgba(190,225,255,.55),inset 0 -3px 8px rgba(2,16,60,.55),inset 3px 0 6px rgba(150,200,255,.12),inset -3px 0 6px rgba(2,16,60,.25)}
.auth .scene{max-width:360px}
.auth .authbox{padding:26px 24px 24px;border-radius:34px}
/* tray logo: palung di dalam kartu, berisi pil logo yang juga masuk ke dalam */
.auth .logobox.alogo,.auth .logobox.alogo.videobox{background:linear-gradient(180deg,rgba(10,44,122,.55),rgba(20,70,170,.38));border:1px solid rgba(120,175,255,.28);border-radius:26px;padding:14px;margin:0 auto 12px;
  box-shadow:inset 0 5px 12px rgba(2,14,52,.65),inset 0 -2px 4px rgba(150,200,255,.28),0 1px 0 rgba(170,215,255,.25)}
.auth .logobox.alogo::before{display:none}
.alogo .al-swap{width:100%;height:62px;border-radius:999px;background:linear-gradient(180deg,#0a2c78,#0d3a96);border:1px solid rgba(110,165,255,.3);
  box-shadow:inset 0 4px 10px rgba(1,10,40,.75),inset 0 -2px 3px rgba(130,185,255,.22);overflow:hidden}
.alogo .al-video{border-radius:999px;box-shadow:none;background:transparent}
.alogo .al-sweep{border-radius:999px}
/* logo asli berlatar putih -> dibalik agar tampil terang di atas pil biru tua (latar hitam dihilangkan oleh blend screen) */
.auth .logobox.alogo .al-swap .al-logo{width:auto;height:84%;max-width:92%;inset:0;margin:auto;filter:invert(1) hue-rotate(180deg) brightness(1.15) blur(10px);mix-blend-mode:screen}
.auth .logobox.alogo .al-swap.is-logo .al-logo{filter:invert(1) hue-rotate(180deg) brightness(1.15)}
/* judul + garis cahaya */
.auth .face h1{font-size:25px;font-weight:700;margin:4px 0 0;letter-spacing:.2px;text-shadow:0 2px 6px rgba(1,10,40,.55)}
.auth .face>p.mute{font-size:14px;letter-spacing:.8px;margin:2px 0 4px;color:#e8f2ff;font-weight:500}
.auth .face>p.mute::after{content:"";display:block;height:2px;margin:12px 6% 6px;border-radius:2px;background:linear-gradient(90deg,transparent,#2f8cff 30%,#6fc4ff 50%,#2f8cff 70%,transparent);box-shadow:0 0 10px rgba(70,160,255,.9)}
/* tab Masuk / Daftar: tray masuk ke dalam, tombol aktif timbul, tombol non-aktif ikut masuk */
.auth .face .tabs{gap:8px;padding:6px;margin:6px 0 14px;border-radius:999px;background:linear-gradient(180deg,rgba(8,36,108,.7),rgba(18,64,160,.45));border:1px solid rgba(120,175,255,.3);
  box-shadow:inset 0 5px 12px rgba(2,14,52,.65),inset 0 -2px 4px rgba(150,200,255,.28)}
.auth .face .tabs button{display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 12px;font-size:14px;font-weight:600;border-radius:999px;color:rgba(200,225,255,.78);
  background:rgba(4,26,88,.55);border:1px solid rgba(110,165,255,.18);box-shadow:inset 0 3px 7px rgba(1,10,40,.6),inset 0 -1px 2px rgba(140,190,255,.2)}
.auth .face .tabs .on{color:#fff;background:linear-gradient(180deg,#2f8cff,#0a54d8);border:1px solid rgba(190,225,255,.7);
  box-shadow:0 5px 14px rgba(0,40,140,.55),0 0 16px rgba(60,150,255,.55),inset 0 1px 1px rgba(255,255,255,.7),inset 0 -2px 4px rgba(0,30,110,.45)}
/* label & isian */
.auth .face label{font-size:14px;font-weight:700;margin:2px 0 6px 2px;text-shadow:0 1px 3px rgba(1,10,40,.55)}
.auth .fld{margin-bottom:12px}
.auth .face input,.auth .face select{min-height:46px;padding:10px 16px;font-size:14.5px;border-radius:18px;color:#fff;
  background:linear-gradient(180deg,rgba(4,24,84,.82),rgba(10,44,122,.62));border:1px solid rgba(120,175,255,.32);
  box-shadow:inset 0 5px 12px rgba(1,10,40,.7),inset 0 -2px 3px rgba(150,200,255,.25),0 1px 0 rgba(170,215,255,.22)}
.auth .face input:focus,.auth .face select:focus{border-color:rgba(150,205,255,.7);outline:0;
  box-shadow:inset 0 5px 12px rgba(1,10,40,.7),inset 0 -2px 3px rgba(150,200,255,.3),0 0 0 3px rgba(70,160,255,.35),0 0 14px rgba(70,160,255,.55)}
.auth .fin,.auth .pw{position:relative}
.auth .fin input,.auth .pw input{padding-left:46px}
.auth .pw input{padding-right:46px}
.auth .fic{position:absolute;left:15px;top:50%;transform:translateY(-50%);display:grid;place-items:center;color:rgba(200,225,255,.9);pointer-events:none;z-index:1}
.auth .face .eye{right:10px;color:rgba(215,235,255,.95)}
.auth .face .info{border-radius:16px;border:1px solid rgba(120,175,255,.3);background:linear-gradient(180deg,rgba(4,24,84,.78),rgba(10,44,122,.55));box-shadow:inset 0 4px 10px rgba(1,10,40,.65),inset 0 -1px 2px rgba(150,200,255,.22)}
/* tombol login: tray masuk ke dalam, tombol timbul di dalamnya */
.auth .btntray{margin-top:16px;padding:12px;border-radius:30px;background:linear-gradient(180deg,rgba(8,36,108,.7),rgba(18,64,160,.42));border:1px solid rgba(120,175,255,.3);
  box-shadow:inset 0 6px 14px rgba(2,14,52,.7),inset 0 -2px 4px rgba(150,200,255,.28)}
.auth .face .pri.wide{width:100%;margin:0;min-height:52px;padding:12px 56px;font-size:17px;font-weight:700;border-radius:999px;border:1px solid rgba(190,225,255,.65);
  background:linear-gradient(180deg,#2f8cff 0%,#0a56e0 55%,#0640b8 100%);
  box-shadow:0 6px 16px rgba(0,36,130,.6),0 0 20px rgba(60,150,255,.5),inset 0 2px 2px rgba(255,255,255,.65),inset 0 -3px 6px rgba(0,30,110,.5)}
.auth .face .pri.wide:hover:not(:disabled){filter:brightness(1.08)}
.auth .face .pri.wide:active:not(:disabled){box-shadow:inset 0 5px 12px rgba(0,20,90,.7),inset 0 -1px 2px rgba(150,200,255,.3);transform:translateY(1px)}
.auth .face .sbtn .sarrow{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:#fff;
  background:radial-gradient(circle at 35% 30%,#2f7cff,#0b3fb8);border:1px solid rgba(180,215,255,.55);box-shadow:inset 0 3px 6px rgba(0,20,90,.65),inset 0 -1px 2px rgba(170,210,255,.45),0 0 10px rgba(60,150,255,.5)}
.auth .face .sbtn.ok{background:linear-gradient(180deg,#34d27b,#128a47)}
.auth .authbox p.foot{color:#dcecff}
@media(max-width:480px){.auth .scene{max-width:min(360px,100%)}.auth .face,.auth .authbox{padding:22px 18px 20px}}

/* ===== Kartu login diperpendek ~20%: tiap sisi setinggi isinya sendiri (tidak lagi ikut sisi Daftar yang lebih tinggi) + jarak dirapatkan ===== */
.auth .face{align-self:center;padding:20px 22px 18px}
.auth .authbox{padding:20px 22px 18px}
.auth .logobox.alogo,.auth .logobox.alogo.videobox{padding:10px;margin-bottom:6px;border-radius:24px}
.alogo .al-swap{height:50px}
.auth .face h1{font-size:23px;margin-top:2px}
.auth .face>p.mute{margin:0 0 2px;font-size:13px}
.auth .face>p.mute::after{margin:8px 6% 4px}
.auth .face .tabs{margin:4px 0 10px;padding:5px}
.auth .face .tabs button{padding:7px 10px}
.auth .face label{margin:0 0 4px 2px;font-size:13px}
.auth .fld{margin-bottom:9px}
.auth .face input,.auth .face select{min-height:42px;padding:8px 14px}
.auth .fin input,.auth .pw input{padding-left:44px}
.auth .btntray{margin-top:12px;padding:9px;border-radius:28px}
.auth .face .pri.wide{min-height:46px;padding:9px 52px;font-size:16px}
.auth .face .sbtn .sarrow{width:32px;height:32px}
/* isian yang terisi otomatis oleh browser tetap timbul ke dalam (sebelumnya rata karena warna autofill menimpa bayangan) */
.auth .face input:-webkit-autofill,.auth .face input:-webkit-autofill:hover,.auth .face input:-webkit-autofill:focus{-webkit-text-fill-color:#fff;caret-color:#fff;transition:background-color 9999s ease-out 0s;
  box-shadow:inset 0 5px 12px rgba(1,10,40,.75),inset 0 -2px 3px rgba(150,200,255,.28),inset 0 0 0 100px #0a2468}
.auth .face input,.auth .face select{box-shadow:inset 0 6px 14px rgba(1,10,40,.8),inset 0 -2px 3px rgba(150,200,255,.3),0 1px 0 rgba(170,215,255,.25)}
@media(max-width:480px){.auth .face,.auth .authbox{padding:18px 16px 16px}}

/* ===== Ganti Password: seluruh elemen model embos ke dalam, senada dengan login ===== */
.pwbox.lux{border-radius:30px;border:1px solid rgba(150,200,255,.5);padding:24px 24px 20px;
  background:linear-gradient(160deg,rgba(40,100,215,.88),rgba(16,58,150,.9) 55%,rgba(26,84,190,.88));
  box-shadow:0 26px 60px rgba(2,14,48,.55),0 6px 14px rgba(2,14,48,.35),inset 0 2px 2px rgba(190,225,255,.55),inset 0 -3px 8px rgba(2,16,60,.55)}
.pwbox.lux .pworn{opacity:.5}
.pwbox.lux .pwlock{width:56px;height:56px;background:linear-gradient(180deg,rgba(8,36,108,.75),rgba(18,64,160,.5));border:1px solid rgba(120,175,255,.35);
  box-shadow:inset 0 5px 10px rgba(1,10,40,.75),inset 0 -2px 3px rgba(150,200,255,.3),0 0 0 6px rgba(8,36,108,.28),0 0 0 7px rgba(130,185,255,.18)}
.pwbox.lux h3{font-size:22px;text-shadow:0 2px 6px rgba(1,10,40,.55)}
.pwbox.lux .pwdiv{margin:10px 6% 0}
.pwbox.lux .pwdiv i{height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,#2f8cff,#6fc4ff,#2f8cff,transparent);box-shadow:0 0 10px rgba(70,160,255,.8)}
.pwbox.lux label{font-size:13px;font-weight:700;margin:0 0 4px 2px}
.pwbox.lux .fld{margin-bottom:10px}
.pwbox.lux input:not([type=checkbox]){min-height:42px;padding:9px 16px;font-size:14px;border-radius:18px;
  background:linear-gradient(180deg,rgba(4,24,84,.82),rgba(10,44,122,.62));border:1px solid rgba(120,175,255,.32);
  box-shadow:inset 0 6px 14px rgba(1,10,40,.8),inset 0 -2px 3px rgba(150,200,255,.3),0 1px 0 rgba(170,215,255,.25)}
.pwbox.lux input:not([type=checkbox]):focus{outline:0;border-color:rgba(150,205,255,.7);box-shadow:inset 0 6px 14px rgba(1,10,40,.8),inset 0 -2px 3px rgba(150,200,255,.3),0 0 0 3px rgba(70,160,255,.35),0 0 14px rgba(70,160,255,.55)}
.pwbox.lux input:-webkit-autofill,.pwbox.lux input:-webkit-autofill:focus{-webkit-text-fill-color:#fff;transition:background-color 9999s ease-out 0s;box-shadow:inset 0 5px 12px rgba(1,10,40,.75),inset 0 -2px 3px rgba(150,200,255,.28),inset 0 0 0 100px #0a2468}
.pwbox.lux .pwshow{padding:8px 12px;border-radius:14px;background:linear-gradient(180deg,rgba(4,24,84,.7),rgba(10,44,122,.45));border:1px solid rgba(120,175,255,.25);box-shadow:inset 0 3px 8px rgba(1,10,40,.65),inset 0 -1px 2px rgba(150,200,255,.22);margin:4px 0 10px}
.pwbox.lux .pwshow input{appearance:none;-webkit-appearance:none;width:18px;height:18px;border-radius:6px;padding:0;min-height:0;cursor:pointer;display:grid;place-items:center;
  background:rgba(2,16,60,.85);border:1px solid rgba(120,175,255,.4);box-shadow:inset 0 3px 6px rgba(1,10,40,.8),inset 0 -1px 1px rgba(150,200,255,.3)}
.pwbox.lux .pwshow input:checked{background:linear-gradient(180deg,#2f8cff,#0a54d8);border-color:rgba(190,225,255,.7)}
.pwbox.lux .pwshow input:checked::after{content:"✓";color:#fff;font-size:12px;line-height:1;font-weight:700}
.pwbox.lux .pwstr .bars{padding:5px 8px;border-radius:999px;background:rgba(2,16,60,.7);box-shadow:inset 0 3px 6px rgba(1,10,40,.75),inset 0 -1px 1px rgba(150,200,255,.25)}
.pwbox.lux .pwerr{border-radius:16px;box-shadow:inset 0 4px 10px rgba(60,0,10,.5),inset 0 -1px 2px rgba(255,190,200,.3)}
.pwbox.lux .acts{margin-top:8px;padding:9px;gap:9px;flex-wrap:nowrap;border-radius:28px;background:linear-gradient(180deg,rgba(8,36,108,.7),rgba(18,64,160,.42));border:1px solid rgba(120,175,255,.3);
  box-shadow:inset 0 6px 14px rgba(2,14,52,.7),inset 0 -2px 4px rgba(150,200,255,.28)}
.pwbox.lux .acts .pri{flex:1.4;min-height:44px;justify-content:center;font-size:15px;font-weight:700;border-radius:999px;border:1px solid rgba(190,225,255,.65);color:#fff;
  background:linear-gradient(180deg,#2f8cff 0%,#0a56e0 55%,#0640b8 100%);box-shadow:0 6px 16px rgba(0,36,130,.6),0 0 18px rgba(60,150,255,.5),inset 0 2px 2px rgba(255,255,255,.65),inset 0 -3px 6px rgba(0,30,110,.5)}
.pwbox.lux .acts .pwcancel{flex:1;min-height:44px;justify-content:center;font-size:14px;font-weight:600;border-radius:999px;color:rgba(210,230,255,.9);
  background:rgba(4,26,88,.55);border:1px solid rgba(110,165,255,.2);box-shadow:inset 0 4px 9px rgba(1,10,40,.7),inset 0 -1px 2px rgba(140,190,255,.22)}
.pwbox.lux .pwfoot{color:#cfe2ff}

/* ===== Daftar: kartu sama tinggi dengan Masuk, isiannya yang dipadatkan ===== */
.auth .face{align-self:stretch;justify-content:center}
.auth .face.b{padding:14px 20px 14px}
.auth .face.b .logobox.alogo,.auth .face.b .logobox.alogo.videobox{padding:10px;margin:0 auto 4px;border-radius:24px}
.auth .face.b .alogo .al-swap{height:36px}
.auth .face.b h1{font-size:19px;margin:0}
.auth .face.b>p.mute{font-size:12px;margin:0}
.auth .face.b>p.mute::after{margin:6px 6% 2px}
.auth .face.b .tabs{margin:2px 0 8px;padding:4px}
.auth .face.b .tabs button{padding:5px 10px;font-size:13px}
.auth .face.b label{font-size:12px;margin:0 0 3px 2px}
.auth .face.b .fld{margin-bottom:6px}
.auth .face.b input,.auth .face.b select{min-height:36px;padding:6px 14px;font-size:13.5px;border-radius:16px}
.auth .face.b .fin input,.auth .face.b .pw input{padding-left:42px}
.auth .face.b .fic{left:14px}
.auth .face.b .btntray{margin-top:8px;padding:7px;border-radius:24px}
.auth .face.b .pri.wide{min-height:40px;padding:7px 20px;font-size:15px}
.auth .face.b .info{padding:6px 10px;font-size:11.5px;margin-bottom:6px}
.auth .face.b{padding:10px 20px 10px}
.auth .face.b .alogo .al-swap{height:50px}
.auth .face.b>p.mute{font-size:0;line-height:0;margin:0}
.auth .face.b>p.mute::after{margin:7px 6% 4px}
.auth .face.b .tabs{margin:0 0 6px}
.auth .face.b .fld{margin-bottom:4px}
.auth .face.b label{font-size:11.5px;margin:0 0 2px 2px}
.auth .face.b input,.auth .face.b select{min-height:32px;padding:4px 14px}
.auth .face.b .btntray{margin-top:5px;padding:5px}
.auth .face.b .pri.wide{min-height:36px;padding-top:6px;padding-bottom:6px}

/* ===== Efek kaca (glass): kartu Masuk, Daftar & Ganti Password tembus pandang + blur latar + kilap diagonal ===== */
.auth .face{isolation:isolate;
  background:linear-gradient(150deg,rgba(70,140,255,calc(.30*var(--g,1) + .10)),rgba(20,70,175,calc(.26*var(--g,1) + .10)) 50%,rgba(40,110,235,calc(.30*var(--g,1) + .10)));
  -webkit-backdrop-filter:blur(20px) saturate(1.7) brightness(1.05);backdrop-filter:blur(20px) saturate(1.7) brightness(1.05);
  border:1px solid rgba(200,230,255,.6);
  box-shadow:0 26px 60px rgba(2,14,48,.5),0 6px 14px rgba(2,14,48,.3),inset 0 1.5px 1px rgba(255,255,255,.8),inset 0 -2px 6px rgba(2,16,60,.4),inset 1px 0 1px rgba(255,255,255,.35),inset -1px 0 1px rgba(255,255,255,.12)}
.auth .face::before{content:"";position:absolute;inset:0;border-radius:inherit;z-index:-1;pointer-events:none;
  background:linear-gradient(125deg,rgba(255,255,255,.34) 0%,rgba(255,255,255,.1) 22%,rgba(255,255,255,0) 40%,rgba(255,255,255,0) 68%,rgba(255,255,255,.16) 100%),radial-gradient(90% 38% at 15% 0%,rgba(255,255,255,.3),transparent 70%)}
.pwbox.lux{isolation:isolate;
  background:linear-gradient(150deg,rgba(70,140,255,.5),rgba(20,70,175,.46) 50%,rgba(40,110,235,.5));
  -webkit-backdrop-filter:blur(22px) saturate(1.7) brightness(1.05);backdrop-filter:blur(22px) saturate(1.7) brightness(1.05);
  border:1px solid rgba(200,230,255,.6);
  box-shadow:0 26px 60px rgba(2,14,48,.5),0 6px 14px rgba(2,14,48,.3),inset 0 1.5px 1px rgba(255,255,255,.8),inset 0 -2px 6px rgba(2,16,60,.4),inset 1px 0 1px rgba(255,255,255,.35),inset -1px 0 1px rgba(255,255,255,.12)}
.pwbox.lux::before{content:"";position:absolute;inset:0;border-radius:inherit;z-index:0;pointer-events:none;
  background:linear-gradient(125deg,rgba(255,255,255,.34) 0%,rgba(255,255,255,.1) 22%,rgba(255,255,255,0) 40%,rgba(255,255,255,0) 68%,rgba(255,255,255,.16) 100%),radial-gradient(90% 38% at 15% 0%,rgba(255,255,255,.3),transparent 70%)}

/* ===== Ganti Password: dipadatkan agar seluruh kartu muat dalam satu layar tanpa scroll ===== */
.pwbox.lux{margin:auto;padding:16px 22px 12px;border-radius:28px;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px)}
.pwbox.lux .pwhead{margin-bottom:6px}
.pwbox.lux .pwlock{width:44px;height:44px;margin-bottom:5px}
.pwbox.lux .pwlock svg{width:22px;height:22px}
.pwbox.lux h3{font-size:19px}
.pwbox.lux .pwhead p{font-size:11.5px;margin-top:2px}
.pwbox.lux .pwdiv{margin:7px 6% 0}
.pwbox.lux label{font-size:12px;margin:0 0 3px 2px}
.pwbox.lux .fld{margin-bottom:7px}
.pwbox.lux input:not([type=checkbox]){min-height:36px;padding:6px 14px;font-size:13.5px;border-radius:16px}
.pwbox.lux .pwstr{margin-top:5px}
.pwbox.lux .pwdesc{font-size:10.5px;line-height:1.35;margin:3px 0 4px}
.pwbox.lux .pwlegend{gap:6px;margin:4px 0 6px;padding:6px;border-radius:14px}
.pwbox.lux .pwlegend>div{padding:5px 4px;text-align:center}
.pwbox.lux .pwlegend b{margin:0;font-size:10.5px}
.pwbox.lux .pwlegend small{display:none}
.pwbox.lux .pwshow{padding:6px 12px;margin:2px 0 7px}
.pwbox.lux .pwerr{margin:0 0 6px;padding:6px 10px;font-size:11.5px}
.pwbox.lux .acts{margin-top:6px;padding:6px;border-radius:26px}
.pwbox.lux .acts .pri,.pwbox.lux .acts .pwcancel{min-height:38px}
.pwbox.lux .pwfoot{margin-top:6px;font-size:10.5px}
@media(max-height:640px){.pwbox.lux .pwhead p,.pwbox.lux .pwdesc{display:none}.pwbox.lux .pwlock{display:none}.pwbox.lux .pwlegend{display:none}}

/* ===== Tombol Cetak PO: hijau = boleh cetak, merah = sudah dicetak (user terkunci, admin yang bisa mengizinkan ulang) ===== */
.ghost.prgreen,button.prgreen{background:linear-gradient(180deg,#2fcf86,#12985a)!important;color:#fff!important;border:1px solid #0d7a43!important;box-shadow:0 3px 10px rgba(18,152,90,.4)!important;font-weight:700}
.ghost.prgreen:hover,button.prgreen:hover{filter:brightness(1.07)}
.prnote{display:inline-block;margin-top:2px;font-size:11.5px;font-weight:600;color:#5b6b7a}
/* ===== Sidebar rapi & stabil (tidak berubah saat hover) ===== */
@media(min-width:901px){
  .shell>.side .navlist,.shell>.side:not(.hov) .navlist{padding:0 7px}
  .shell>.side .navpill,.shell>.side:not(.hov) .navpill{left:7px;right:7px}
  .shell>.side .nv,.shell>.side:not(.hov) .nv,.shell>.side .sub .nv{height:40px;min-height:40px;padding:0 0 0 18px!important;gap:12px!important;justify-content:flex-start!important;font-size:13px!important;font-weight:500;line-height:1.2!important;overflow:hidden}
  .shell>.side .nv .ic,.shell>.side .nv svg{width:17px;height:17px;flex:none}
  .shell>.side .nv:hover>*:not(.bd),.shell>.side .nv:focus-visible>*:not(.bd){transform:none!important}
  .shell>.side .nv>span,.shell>.side:not(.hov) .nv>span{max-width:none!important;transition:opacity .2s ease!important}
  .shell>.side:not(.hov) .nv>span{opacity:0}
  .shell>.side .nv.grp{justify-content:space-between!important;padding:0 12px 0 18px!important;height:34px;min-height:34px;font-size:12.5px!important}
  .shell>.side:not(.hov) .nv .bd{position:absolute;top:4px;right:9px;margin:0}
}
/* ===== Dashboard: konten menyesuaikan sidebar; hanya font/susunan dalam kartu yang menyesuaikan lebar kartu ===== */
.dtop>.dcard{container-type:inline-size;min-width:0}
.ts b,.sc b{overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ts .tl,.ts .tl2{line-height:1.25}
.dtop .ts b{font-size:clamp(14px,2.7cqw,21px)}
.dtop .sc b{font-size:clamp(14px,2.7cqw,20px)}
.dtop .stleg .lt b{font-size:clamp(13px,2.9cqw,15px)}
@container (max-width:640px){
  .tstats{grid-template-columns:1fr 1fr}
  .ts{border-bottom:1px solid rgba(150,190,235,.4);padding:10px 14px}
  .ts:nth-child(2n){border-right:0}
  .ts:nth-last-child(-n+2){border-bottom:0}
}
@container (max-width:480px){
  .stwrap{grid-template-columns:1fr;gap:10px}
  .sgrid{grid-template-columns:1fr}
  .sc,.sc:first-child,.sc:last-child{border-right:0;padding:8px 0;border-bottom:1px solid rgba(150,190,235,.4)}
  .sc:last-child{border-bottom:0}
}
/* ===== Card login lebih kecil & proporsional ===== */
.auth .scene{zoom:.8}
@media(max-width:700px){.auth .scene{zoom:.92}}
`;
