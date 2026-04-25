import { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, serverTimestamp
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { Plus, Trash2, X, BarChart2, ChevronLeft, AlertCircle } from 'lucide-react'

const MONTHS = [
  'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'
]

const PRESETS = [
  { nome: 'Minimo contrattuale', pos: true },
  { nome: 'Scatti di anzianità', pos: true },
  { nome: 'Superminimo', pos: true },
  { nome: 'Straordinario', pos: true },
  { nome: 'Lavoro festivo', pos: true },
  { nome: 'Premio / Bonus', pos: true },
  { nome: '13ª mensilità', pos: true },
  { nome: '14ª mensilità', pos: true },
  { nome: 'Indennità varie', pos: true },
  { nome: 'TFR', pos: true },
  { nome: 'Contributi INPS', pos: false },
  { nome: 'IRPEF', pos: false },
  { nome: 'Detrazione IRPEF', pos: true },
  { nome: 'Addizionale regionale', pos: false },
  { nome: 'Addizionale comunale', pos: false },
]

const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const fmt = (n) => EUR.format(n)
const makeId = () => Math.random().toString(36).slice(2, 10)

function fmtDelta(n) {
  return (n > 0 ? '+' : '') + fmt(n)
}

function explain(nome, delta) {
  const n = nome.toLowerCase()
  const dir = delta > 0 ? 'aumentato/a' : 'diminuito/a'
  const abs = fmt(Math.abs(delta))
  if (n.includes('irpef') && !n.includes('addizionale') && !n.includes('detrazione'))
    return `IRPEF ${dir} di ${abs}. Verifica se è cambiato il reddito imponibile, il conguaglio fiscale o le aliquote.`
  if (n.includes('inps'))
    return `Contributi INPS ${dir} di ${abs}. Direttamente correlato alla variazione dello stipendio lordo.`
  if (n.includes('straordinario'))
    return `Straordinario ${dir} di ${abs}. Ore extra lavorate diverse dal mese precedente.`
  if (n.includes('bonus') || n.includes('premio'))
    return `Premio/Bonus ${dir} di ${abs}. Erogazione, variazione o mancata erogazione del premio.`
  if (n.includes('addizionale reg'))
    return `Addizionale regionale ${dir} di ${abs}. Può variare con il conguaglio di fine anno o cambio aliquota.`
  if (n.includes('addizionale com'))
    return `Addizionale comunale ${dir} di ${abs}. Dipende dal comune di residenza; varia con il conguaglio.`
  if (n.includes('detrazione'))
    return `Detrazione IRPEF ${dir} di ${abs}. Cambiamento nelle detrazioni per lavoro dipendente o familiari a carico.`
  if (n.includes('13') || n.includes('tredicesima'))
    return `13ª mensilità ${dir} di ${abs}. Erogazione o variazione del rateo mensile.`
  if (n.includes('14') || n.includes('quattordicesima'))
    return `14ª mensilità ${dir} di ${abs}. Erogazione della quattordicesima (dove prevista dal CCNL).`
  if (n.includes('minimo') || n.includes('contrattuale'))
    return `Minimo contrattuale ${dir} di ${abs}. Possibile rinnovo CCNL, promozione o inquadramento.`
  if (n.includes('scatt') || n.includes('anzianità'))
    return `Scatti di anzianità ${dir} di ${abs}. Maturazione di un nuovo scatto contrattuale.`
  if (n.includes('festiv'))
    return `Lavoro festivo ${dir} di ${abs}. Festività lavorate diverse rispetto al mese precedente.`
  if (n.includes('tfr'))
    return `TFR ${dir} di ${abs}. Variazione del rateo di accantonamento TFR.`
  if (n.includes('superminimo'))
    return `Superminimo ${dir} di ${abs}. Variazione dell'assegno individuale aggiuntivo.`
  return `${nome} ${dir} di ${abs}.`
}

export default function Payslip() {
  const { user } = useAuth()
  const [payslips, setPayslips] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const now = new Date()
  const [formMonth, setFormMonth] = useState(now.getMonth())
  const [formYear, setFormYear] = useState(now.getFullYear())
  const [formVoci, setFormVoci] = useState([])
  const [formNote, setFormNote] = useState('')
  const [customVoce, setCustomVoce] = useState('')
  const [saving, setSaving] = useState(false)

  const colRef = useMemo(() => collection(db, 'users', user.uid, 'payslips'), [user.uid])

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(query(colRef, orderBy('yearMonth', 'desc')))
      setPayslips(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error('Payslip load error:', e)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function resetForm() {
    const d = new Date()
    setFormMonth(d.getMonth())
    setFormYear(d.getFullYear())
    setFormVoci([])
    setFormNote('')
    setCustomVoce('')
  }

  function addPreset(preset) {
    if (formVoci.some(v => v.nome.toLowerCase() === preset.nome.toLowerCase())) return
    setFormVoci(prev => [...prev, { id: makeId(), nome: preset.nome, importo: '', pos: preset.pos }])
  }

  function addCustom() {
    const nome = customVoce.trim()
    if (!nome) return
    setFormVoci(prev => [...prev, { id: makeId(), nome, importo: '', pos: true }])
    setCustomVoce('')
  }

  function updateVoce(id, field, value) {
    setFormVoci(prev => prev.map(v => v.id === id ? { ...v, [field]: value } : v))
  }

  const formNetto = useMemo(() =>
    formVoci.reduce((sum, v) => sum + (v.pos ? 1 : -1) * (parseFloat(v.importo) || 0), 0)
  , [formVoci])

  async function savePayslip() {
    if (formVoci.length === 0) return
    setSaving(true)
    try {
      const yearMonth = `${formYear}-${String(formMonth + 1).padStart(2, '0')}`
      const voci = formVoci.map(v => ({
        id: v.id,
        nome: v.nome,
        importo: (v.pos ? 1 : -1) * (parseFloat(v.importo) || 0)
      }))
      const netto = voci.reduce((s, v) => s + v.importo, 0)
      await addDoc(colRef, {
        yearMonth,
        label: `${MONTHS[formMonth]} ${formYear}`,
        voci,
        netto,
        note: formNote,
        createdAt: serverTimestamp()
      })
      await load()
      resetForm()
      setView('list')
    } catch (e) {
      console.error('Payslip save error:', e)
    }
    setSaving(false)
  }

  async function deletePayslip(id) {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'payslips', id))
      await load()
      setDeleteConfirm(null)
      if (selectedId === id) setView('list')
    } catch (e) {
      console.error('Payslip delete error:', e)
    }
  }

  function getDelta(p, idx) {
    const prev = payslips[idx + 1]
    if (!prev) return null
    return p.netto - prev.netto
  }

  const compareData = useMemo(() => {
    if (!compareA || !compareB || compareA === compareB) return null
    const a = payslips.find(p => p.id === compareA)
    const b = payslips.find(p => p.id === compareB)
    if (!a || !b) return null

    const allNames = [...new Set([...a.voci.map(v => v.nome), ...b.voci.map(v => v.nome)])]
    const rows = allNames.map(nome => {
      const va = a.voci.find(v => v.nome === nome)
      const vb = b.voci.find(v => v.nome === nome)
      const importoA = va?.importo ?? 0
      const importoB = vb?.importo ?? 0
      return { nome, importoA, importoB, delta: importoA - importoB }
    })

    rows.sort((x, y) => {
      const xPos = x.importoA >= 0 && x.importoB >= 0
      const yPos = y.importoA >= 0 && y.importoB >= 0
      if (xPos && !yPos) return -1
      if (!xPos && yPos) return 1
      return Math.abs(y.delta) - Math.abs(x.delta)
    })

    const top3 = [...rows]
      .filter(r => Math.abs(r.delta) > 0.009)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
      .slice(0, 3)

    return { a, b, rows, top3, nettoA: a.netto, nettoB: b.netto, nettoDelta: a.netto - b.netto }
  }, [compareA, compareB, payslips])

  const selectedPayslip = useMemo(() => payslips.find(p => p.id === selectedId), [payslips, selectedId])

  // ─── LOADING ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-64">
        <p className="text-warm-muted text-sm">Caricamento...</p>
      </div>
    )
  }

  // ─── ADD FORM ────────────────────────────────────────────────────────────────
  if (view === 'add') {
    return (
      <div className="page-container animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => { resetForm(); setView('list') }}
            className="p-2 rounded-xl hover:bg-gray-100 transition-all"
          >
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold">Nuova busta paga</h1>
        </div>

        {/* Periodo */}
        <div className="card mb-4">
          <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Periodo</p>
          <div className="flex gap-3">
            <select
              value={formMonth}
              onChange={e => setFormMonth(Number(e.target.value))}
              className="input-field flex-1"
            >
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <input
              type="number"
              value={formYear}
              onChange={e => setFormYear(Number(e.target.value))}
              className="input-field w-28"
              min="2000"
              max="2100"
            />
          </div>
          <input
            type="text"
            placeholder="Note (opzionale)..."
            value={formNote}
            onChange={e => setFormNote(e.target.value)}
            className="input-field mt-3"
          />
        </div>

        {/* Preset voci */}
        <div className="card mb-4">
          <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Voci rapide</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => {
              const added = formVoci.some(v => v.nome.toLowerCase() === p.nome.toLowerCase())
              return (
                <button
                  key={p.nome}
                  onClick={() => addPreset(p)}
                  className={added ? 'chip-active text-xs' : 'chip-inactive text-xs'}
                >
                  <span className={added ? '' : p.pos ? 'text-secondary-dark' : 'text-red-500'}>
                    {p.pos ? '+' : '−'}
                  </span>
                  {' '}{p.nome}
                </button>
              )
            })}
          </div>
        </div>

        {/* Importi */}
        {formVoci.length > 0 && (
          <div className="card mb-4">
            <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Importi</p>
            <div className="space-y-2.5">
              {formVoci.map(v => (
                <div key={v.id} className="flex items-center gap-2">
                  <button
                    onClick={() => updateVoce(v.id, 'pos', !v.pos)}
                    className={`w-8 h-8 rounded-lg text-sm font-bold flex-shrink-0 transition-all ${
                      v.pos ? 'bg-secondary/20 text-secondary-dark' : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {v.pos ? '+' : '−'}
                  </button>
                  <span className="flex-1 text-sm font-medium truncate">{v.nome}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-warm-muted text-sm">€</span>
                    <input
                      type="number"
                      value={v.importo}
                      onChange={e => updateVoce(v.id, 'importo', e.target.value)}
                      className="w-24 py-1.5 px-2 rounded-xl border-2 border-gray-200 focus:border-primary focus:outline-none text-right text-sm transition-all"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <button
                    onClick={() => setFormVoci(prev => prev.filter(x => x.id !== v.id))}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Voce custom */}
        <div className="card mb-4">
          <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Voce personalizzata</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={customVoce}
              onChange={e => setCustomVoce(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustom()}
              placeholder="Nome voce..."
              className="input-field flex-1"
            />
            <button
              onClick={addCustom}
              className="p-3 bg-primary/10 text-primary rounded-xl hover:bg-primary/20 transition-all"
            >
              <Plus size={18} />
            </button>
          </div>
        </div>

        {/* Netto preview */}
        {formVoci.length > 0 && (
          <div className="card mb-6 border-primary/20 bg-primary/5">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Netto in busta</span>
              <span className={`text-2xl font-bold ${formNetto >= 0 ? 'text-secondary-dark' : 'text-red-600'}`}>
                {fmt(formNetto)}
              </span>
            </div>
          </div>
        )}

        <button
          onClick={savePayslip}
          disabled={saving || formVoci.length === 0}
          className="btn-primary w-full"
        >
          {saving ? 'Salvataggio...' : 'Salva busta paga'}
        </button>
      </div>
    )
  }

  // ─── DETAIL VIEW ─────────────────────────────────────────────────────────────
  if (view === 'detail' && selectedPayslip) {
    const positives = selectedPayslip.voci.filter(v => v.importo >= 0)
    const negatives = selectedPayslip.voci.filter(v => v.importo < 0)
    const totComp = positives.reduce((s, v) => s + v.importo, 0)
    const totTrat = negatives.reduce((s, v) => s + Math.abs(v.importo), 0)

    return (
      <div className="page-container animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button onClick={() => setView('list')} className="p-2 rounded-xl hover:bg-gray-100 transition-all">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-bold">{selectedPayslip.label}</h1>
              {selectedPayslip.note && <p className="text-xs text-warm-muted">{selectedPayslip.note}</p>}
            </div>
          </div>
          <button
            onClick={() => setDeleteConfirm(selectedPayslip.id)}
            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Netto box */}
        <div className="card mb-4 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <p className="text-sm text-warm-muted mb-1">Netto in busta</p>
          <p className="text-3xl font-bold text-primary">{fmt(selectedPayslip.netto)}</p>
          <div className="flex gap-4 mt-2 text-xs">
            <span className="text-secondary-dark font-medium">Competenze: {fmt(totComp)}</span>
            <span className="text-red-500 font-medium">Trattenute: {fmt(totTrat)}</span>
          </div>
        </div>

        {/* Competenze */}
        {positives.length > 0 && (
          <div className="card mb-3">
            <p className="text-xs font-semibold text-secondary-dark uppercase tracking-wide mb-3">Competenze</p>
            <div className="space-y-2">
              {positives.map(v => (
                <div key={v.id} className="flex justify-between items-center py-0.5">
                  <span className="text-sm">{v.nome}</span>
                  <span className="font-semibold text-secondary-dark tabular-nums">{fmt(v.importo)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trattenute */}
        {negatives.length > 0 && (
          <div className="card mb-3">
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-3">Trattenute</p>
            <div className="space-y-2">
              {negatives.map(v => (
                <div key={v.id} className="flex justify-between items-center py-0.5">
                  <span className="text-sm">{v.nome}</span>
                  <span className="font-semibold text-red-500 tabular-nums">{fmt(v.importo)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Delete confirm */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-bold text-red-600 mb-2">Elimina busta paga</h3>
              <p className="text-sm text-warm-text mb-6">Sei sicuro? L'operazione non è reversibile.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 font-medium">Annulla</button>
                <button onClick={() => deletePayslip(deleteConfirm)} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium">Elimina</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── COMPARE VIEW ────────────────────────────────────────────────────────────
  if (view === 'compare') {
    return (
      <div className="page-container animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => setView('list')} className="p-2 rounded-xl hover:bg-gray-100 transition-all">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-xl font-bold">Confronta buste paga</h1>
        </div>

        {/* Selettori mese */}
        <div className="card mb-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-warm-muted mb-1.5 font-medium">Mese A</p>
              <select
                value={compareA}
                onChange={e => setCompareA(e.target.value)}
                className="input-field text-sm"
              >
                <option value="">Seleziona...</option>
                {payslips.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-xs text-warm-muted mb-1.5 font-medium">Mese B</p>
              <select
                value={compareB}
                onChange={e => setCompareB(e.target.value)}
                className="input-field text-sm"
              >
                <option value="">Seleziona...</option>
                {payslips.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {compareA && compareB && compareA === compareB && (
          <div className="card flex items-center gap-3 text-warm-muted mb-4">
            <AlertCircle size={18} className="flex-shrink-0" />
            <p className="text-sm">Seleziona due mesi diversi per confrontarli.</p>
          </div>
        )}

        {compareData && (
          <>
            {/* Netto a confronto */}
            <div className="card mb-4">
              <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Netto a confronto</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="text-center p-3 bg-primary/5 rounded-2xl">
                  <p className="text-xs text-warm-muted mb-1">{compareData.a.label}</p>
                  <p className="text-xl font-bold text-primary tabular-nums">{fmt(compareData.nettoA)}</p>
                </div>
                <div className="text-center p-3 bg-gray-50 rounded-2xl">
                  <p className="text-xs text-warm-muted mb-1">{compareData.b.label}</p>
                  <p className="text-xl font-bold text-warm-text tabular-nums">{fmt(compareData.nettoB)}</p>
                </div>
              </div>
              <div className={`text-center py-2.5 rounded-xl font-semibold text-sm ${
                compareData.nettoDelta > 0 ? 'bg-secondary/10 text-secondary-dark' :
                compareData.nettoDelta < 0 ? 'bg-red-50 text-red-600' :
                'bg-gray-50 text-warm-muted'
              }`}>
                {compareData.nettoDelta > 0 ? '▲ ' : compareData.nettoDelta < 0 ? '▼ ' : '= '}
                {fmtDelta(compareData.nettoDelta)} rispetto a {compareData.b.label}
              </div>
            </div>

            {/* Top 3 cause */}
            {compareData.top3.length > 0 && (
              <div className="card mb-4">
                <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-4">Top 3 cause del cambiamento</p>
                <div className="space-y-4">
                  {compareData.top3.map((row, i) => (
                    <div key={row.nome} className="flex gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0 ? 'bg-yellow-100 text-yellow-700' :
                        i === 1 ? 'bg-gray-100 text-gray-500' :
                        'bg-orange-50 text-orange-500'
                      }`}>
                        {i + 1}
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${row.delta > 0 ? 'text-secondary-dark' : 'text-red-600'}`}>
                          {row.delta > 0 ? '▲' : '▼'} {fmt(Math.abs(row.delta))} — {row.nome}
                        </p>
                        <p className="text-xs text-warm-muted mt-0.5 leading-relaxed">
                          {explain(row.nome, row.delta)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {compareData.top3.length === 0 && (
              <div className="card mb-4 text-center py-6">
                <p className="text-warm-muted text-sm">Nessuna variazione tra i due mesi.</p>
              </div>
            )}

            {/* Tabella dettaglio */}
            <div className="card mb-4">
              <p className="text-xs font-semibold text-warm-muted uppercase tracking-wide mb-3">Dettaglio voci</p>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs text-warm-muted pb-2 border-b border-gray-100">
                <div>Voce</div>
                <div className="text-right">{compareData.a.label.split(' ')[0]}</div>
                <div className="text-right w-16">Δ rispetto B</div>
              </div>
              {compareData.rows.map(row => {
                const changed = Math.abs(row.delta) > 0.009
                return (
                  <div
                    key={row.nome}
                    className={`grid grid-cols-[1fr_auto_auto] gap-x-3 py-2 text-xs border-b border-gray-50 last:border-0 ${
                      changed ? '' : 'opacity-60'
                    }`}
                  >
                    <div className="truncate">{row.nome}</div>
                    <div className="text-right tabular-nums">
                      {row.importoA !== 0 ? fmt(row.importoA) : '—'}
                    </div>
                    <div className={`text-right font-bold tabular-nums w-16 ${
                      !changed ? 'text-warm-muted' :
                      row.delta > 0 ? 'text-secondary-dark' : 'text-red-500'
                    }`}>
                      {!changed ? '=' : fmtDelta(row.delta)}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── LIST VIEW ───────────────────────────────────────────────────────────────
  return (
    <div className="page-container animate-fade-in">
      <div className="flex justify-between items-center mb-1">
        <h1 className="text-2xl font-bold">Buste Paga 💰</h1>
        <button
          onClick={() => { resetForm(); setView('add') }}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-primary-dark transition-all active:scale-95"
        >
          <Plus size={16} />
          Aggiungi
        </button>
      </div>
      <p className="text-warm-muted text-sm mb-5">Confronta le tue buste paga mese per mese</p>

      {payslips.length === 0 ? (
        <div className="card text-center py-14">
          <div className="text-5xl mb-4">💼</div>
          <p className="font-bold text-warm-text mb-1">Nessuna busta paga ancora</p>
          <p className="text-sm text-warm-muted mb-6">
            Aggiungi la tua prima busta paga per iniziare a tracciare variazioni e confrontare i mesi
          </p>
          <button
            onClick={() => { resetForm(); setView('add') }}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus size={16} />
            Aggiungi busta paga
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3 mb-5">
            {payslips.map((p, idx) => {
              const delta = getDelta(p, idx)
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setView('detail') }}
                  className="card w-full text-left hover:shadow-md active:scale-[0.98] transition-all"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-bold">{p.label}</p>
                      {p.note && <p className="text-xs text-warm-muted mt-0.5">{p.note}</p>}
                      {delta === null && (
                        <p className="text-xs text-warm-muted mt-0.5">Prima busta paga</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-primary tabular-nums">{fmt(p.netto)}</p>
                      {delta !== null && (
                        <p className={`text-xs font-semibold mt-0.5 tabular-nums ${
                          delta > 0 ? 'text-secondary-dark' :
                          delta < 0 ? 'text-red-500' :
                          'text-warm-muted'
                        }`}>
                          {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {fmt(Math.abs(delta))}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {payslips.length >= 2 && (
            <button
              onClick={() => {
                setCompareA(payslips[0]?.id || '')
                setCompareB(payslips[1]?.id || '')
                setView('compare')
              }}
              className="btn-outline w-full flex items-center justify-center gap-2"
            >
              <BarChart2 size={18} />
              Confronta buste paga
            </button>
          )}
        </>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-red-600 mb-2">Elimina busta paga</h3>
            <p className="text-sm text-warm-text mb-6">Sei sicuro? L'operazione non è reversibile.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 font-medium">Annulla</button>
              <button onClick={() => deletePayslip(deleteConfirm)} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-medium">Elimina</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
