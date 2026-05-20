import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api";
import { ArrowLeft, Trophy } from "lucide-react";

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/leaderboard");
        setRows(data);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F4F5] halftone-light p-6 md:p-12" data-testid="leaderboard-page">
      <div className="flex items-center justify-between mb-8">
        <Link to="/lobby" className="btn-pow bg-white text-black" data-testid="leaderboard-back-button">
          <span className="flex items-center gap-2"><ArrowLeft size={18} strokeWidth={3} /> BACK</span>
        </Link>
        <div className="inline-block bg-[#FFD700] border-pow shadow-pow-sm px-3 py-1 rotate-2">
          <span className="font-anton uppercase tracking-widest flex items-center gap-2">
            <Trophy size={18} strokeWidth={3} /> HALL OF FAME
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-6xl uppercase text-[#E62429] text-pow-shadow-lg mb-6">LEADERBOARD</h1>

        <div className="card-pow p-0 overflow-hidden">
          <div className="grid grid-cols-12 bg-black text-white font-anton uppercase tracking-widest px-4 py-3 text-sm">
            <div className="col-span-1">#</div>
            <div className="col-span-5">Player</div>
            <div className="col-span-2 text-right">Kills</div>
            <div className="col-span-2 text-right">Deaths</div>
            <div className="col-span-2 text-right">K/D</div>
          </div>
          {loading ? (
            <div className="p-8 font-display text-3xl text-center">LOADING...</div>
          ) : rows.length === 0 ? (
            <div className="p-8 font-anton text-center uppercase text-neutral-500">No frags yet. Be the first.</div>
          ) : (
            rows.map((r, i) => (
              <div
                key={r.username + i}
                className={`grid grid-cols-12 px-4 py-3 border-t-2 border-black font-body items-center ${
                  i === 0 ? "bg-[#FFD700]" : i === 1 ? "bg-[#FFE680]" : i === 2 ? "bg-[#FFF0AC]" : "bg-white"
                }`}
                data-testid={`leaderboard-row-${i}`}
              >
                <div className="col-span-1 font-display text-2xl">{i + 1}</div>
                <div className="col-span-5 font-anton uppercase text-lg">{r.username}</div>
                <div className="col-span-2 text-right font-anton text-lg">{r.kills}</div>
                <div className="col-span-2 text-right font-anton text-lg">{r.deaths}</div>
                <div className="col-span-2 text-right font-display text-2xl">{r.kd}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
