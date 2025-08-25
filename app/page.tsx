import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import { TrendingUp, Upload, CalendarClock, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

// --- Utilities ---
const fmtPct = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : `${x.toFixed(1)}%`);
const fmt2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toFixed(2));

// BLS Public API endpoints (no key required for small requests)
// Docs: https://api.bls.gov/publicAPI/v2/timeseries/data/
const BLS_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data";

// Series IDs (confirmed in BLS docs)
// Headline CPI (All Urban Consumers, U.S. city avg)
const SERIES = {
  HEADLINE_NSA: "CUUR0000SA0", // Not seasonally adjusted (good for YoY)
  HEADLINE_SA: "CUSR0000SA0", // Seasonally adjusted (good for MoM)
  CORE_SA: "CUSR0000SA0L1E", // Seasonally adjusted, less food & energy
};

// Compute YoY % change given an array of monthly index values
function pctChangeYoY(series) {
  if (!series || series.length < 13) return null;
  const latest = series[series.length - 1];
  const prevYear = series[series.length - 13];
  return ((latest - prevYear) / prevYear) * 100;
}
// Compute MoM % change (SA series recommended)
function pctChangeMoM(series) {
  if (!series || series.length < 2) return null;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  return ((latest - prev) / prev) * 100;
}

// Parse BLS API payload -> sorted monthly points oldest..newest
function parseBlsSeries(json) {
  try {
    const series = json.Results.series[0];
    const points = series.data
      .map((d) => ({
        date: new Date(`${d.year}-${d.period.substr(1)}-01`),
        value: parseFloat(d.value),
      }))
      .sort((a, b) => a.date - b.date);
    return points;
  } catch (e) {
    return [];
  }
}

async function fetchSeries(seriesId, startYear) {
  const url = `${BLS_BASE}/${seriesId}?startyear=${startYear}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`BLS fetch failed (${res.status})`);
  return res.json();
}

function useBlsData({ startYear }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ loading: true, error: null, data: null });
      try {
        const [hNSA, hSA, coreSA] = await Promise.all([
          fetchSeries(SERIES.HEADLINE_NSA, startYear),
          fetchSeries(SERIES.HEADLINE_SA, startYear),
          fetchSeries(SERIES.CORE_SA, startYear),
        ]);
        if (cancelled) return;
        const headlineNSA = parseBlsSeries(hNSA);
        const headlineSA = parseBlsSeries(hSA);
        const coreSAData = parseBlsSeries(coreSA);
        setState({
          loading: false,
          error: null,
          data: { headlineNSA, headlineSA, coreSA: coreSAData },
        });
      } catch (e) {
        if (cancelled) return;
        setState({ loading: false, error: e.message, data: null });
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [startYear]);

  return state;
}

// Next scheduled CPI release — you can update this in Settings without redeploying
// Source: bls.gov/cpi (Next Release)
const DEFAULT_NEXT_RELEASE_ET = "2025-09-11T08:30:00-04:00"; // 8:30 AM ET

function useCountdown(targetIso) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const target = new Date(targetIso);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const s = Math.floor(diff / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return { days, hours, minutes, seconds, reached: diff === 0 };
}

export default function InflationTrackerApp() {
  const [startYear, setStartYear] = useState(2015);
  const [nextReleaseIso, setNextReleaseIso] = useState(DEFAULT_NEXT_RELEASE_ET);
  const { loading, error, data } = useBlsData({ startYear });
  const countdown = useCountdown(nextReleaseIso);

  const metrics = useMemo(() => {
    if (!data) return null;
    const hNSA = data.headlineNSA.map((p) => p.value);
    const hSA = data.headlineSA.map((p) => p.value);
    const core = data.coreSA.map((p) => p.value);
    return {
      headlineYoY: pctChangeYoY(hNSA),
      headlineMoM: pctChangeMoM(hSA),
      coreYoY: pctChangeYoY(core),
      coreMoM: pctChangeMoM(core),
      lastDate: data.headlineNSA[data.headlineNSA.length - 1]?.date ?? null,
    };
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    // Build unified monthly rows based on headlineNSA dates
    return data.headlineNSA.map((row, i) => {
      const label = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
      return {
        date: label,
        Headline_NSA: row.value,
        Headline_SA: data.headlineSA[i]?.value ?? null,
        Core_SA: data.coreSA[i]?.value ?? null,
      };
    });
  }, [data]);

  const lastRefreshed = useMemo(() => new Date().toLocaleString(), [data]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-white text-slate-900">
      <header className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-7 h-7" />
          <h1 className="text-2xl sm:text-3xl font-bold">U.S. Inflation Tracker</h1>
        </div>
        <div className="text-sm opacity-70">Last refreshed: {lastRefreshed}</div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-12">
        {/* Top KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide opacity-60">Headline CPI (YoY)</div>
              <div className="text-3xl font-semibold mt-1">{fmtPct(metrics?.headlineYoY)}</div>
              <div className="text-xs mt-2 opacity-60">Source: BLS (NSA)</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide opacity-60">Headline CPI (MoM)</div>
              <div className="text-3xl font-semibold mt-1">{fmtPct(metrics?.headlineMoM)}</div>
              <div className="text-xs mt-2 opacity-60">Source: BLS (SA)</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide opacity-60">Core CPI (YoY)</div>
              <div className="text-3xl font-semibold mt-1">{fmtPct(metrics?.coreYoY)}</div>
              <div className="text-xs mt-2 opacity-60">Less food & energy (SA)</div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="text-xs uppercase tracking-wide opacity-60">Core CPI (MoM)</div>
              <div className="text-3xl font-semibold mt-1">{fmtPct(metrics?.coreMoM)}</div>
              <div className="text-xs mt-2 opacity-60">Less food & energy (SA)</div>
            </CardContent>
          </Card>
        </div>

        {/* Release countdown & controls */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <Card className="rounded-2xl shadow-sm lg:col-span-2">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CalendarClock className="w-5 h-5" />
                  <div>
                    <div className="text-sm opacity-70">Next CPI release (ET)</div>
                    <div className="font-semibold">{new Date(nextReleaseIso).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-center">
                  <div>
                    <div className="text-3xl font-bold">{String(countdown.days).padStart(2, "0")}</div>
                    <div className="text-xs opacity-60">Days</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold">{String(countdown.hours).padStart(2, "0")}</div>
                    <div className="text-xs opacity-60">Hours</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold">{String(countdown.minutes).padStart(2, "0")}</div>
                    <div className="text-xs opacity-60">Mins</div>
                  </div>
                  <div>
                    <div className="text-3xl font-bold">{String(countdown.seconds).padStart(2, "0")}</div>
                    <div className="text-xs opacity-60">Secs</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5">
              <div className="text-sm font-semibold mb-3">Settings</div>
              <div className="space-y-3">
                <div>
                  <div className="text-xs mb-1 opacity-60">Chart start year</div>
                  <Input
                    type="number"
                    min={1994}
                    max={new Date().getFullYear()}
                    value={startYear}
                    onChange={(e) => setStartYear(parseInt(e.target.value || "2015", 10))}
                  />
                </div>
                <div>
                  <div className="text-xs mb-1 opacity-60">Next release datetime (ISO)</div>
                  <Input value={nextReleaseIso} onChange={(e) => setNextReleaseIso(e.target.value)} />
                </div>
                <div className="text-xs opacity-60">Data via BLS Public API. No API key required for small requests.</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm opacity-70">Index level (1982-84=100)</div>
                <div className="font-semibold">Headline vs Core CPI</div>
              </div>
              <Button variant="outline" className="gap-2" onClick={() => window.location.reload()}>
                <RefreshCw className="w-4 h-4" /> Refresh
              </Button>
            </div>
            {loading && <div className="py-10 text-center opacity-70">Loading BLS data…</div>}
            {error && (
              <div className="py-10 text-center text-red-600">
                Failed to load BLS data: {error}
                <div className="text-xs mt-2 opacity-70">If you hit anonymous rate limits, try again in a minute or use your own backend cache.</div>
              </div>
            )}
            {!loading && !error && (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} domain={["dataMin", "dataMax"]} />
                    <Tooltip formatter={(v) => (typeof v === "number" ? fmt2(v) : v)} />
                    <Legend />
                    <Line type="monotone" dataKey="Headline_NSA" dot={false} strokeWidth={2} name="Headline (NSA)" />
                    <Line type="monotone" dataKey="Core_SA" dot={false} strokeWidth={2} name="Core (SA)" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {metrics?.lastDate && (
              <div className="text-xs mt-2 opacity-60">
                Latest month: {metrics.lastDate.toLocaleDateString(undefined, { year: "numeric", month: "long" })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* How it works */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5 text-sm">
              <div className="font-semibold mb-2">What "real-time" means here</div>
              <p>
                CPI is published monthly by the U.S. Bureau of Labor Statistics. This page refreshes automatically and updates the
                indicators the moment new data appear on the BLS Public API.
              </p>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5 text-sm">
              <div className="font-semibold mb-2">Methodology</div>
              <ul className="list-disc pl-5 space-y-1">
                <li>YoY uses <span className="font-mono">CUUR0000SA0</span> (NSA). MoM uses <span className="font-mono">CUSR0000SA0</span> (SA).</li>
                <li>Core CPI uses <span className="font-mono">CUSR0000SA0L1E</span> (SA), excluding food & energy.</li>
                <li>Index base = 1982–84 = 100.</li>
              </ul>
            </CardContent>
          </Card>
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="p-5 text-sm">
              <div className="font-semibold mb-2">Deploying</div>
              <p>
                This is a single-file React component. Drop it into a Next.js/React app with Tailwind and shadcn/ui enabled and publish
                on Vercel, Netlify, or GitHub Pages. No server is required.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-4 py-10 text-xs opacity-60">
        Data © U.S. Bureau of Labor Statistics. This site is unofficial.
      </footer>
    </div>
  );
}
