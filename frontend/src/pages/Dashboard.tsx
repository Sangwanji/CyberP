import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useNavigate } from 'react-router-dom';

interface ScanHistory {
  id: string;
  target_url: string;
  status: string;
  created_at: string;
}

export default function Dashboard() {
  const [scans, setScans] = useState<ScanHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchScans = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate('/login');
        return;
      }

      const { data, error } = await supabase
        .from('scans')
        .select('id, target_url, status, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching scans:', error);
      } else {
        setScans(data || []);
      }
      
      setLoading(false);
    };

    void fetchScans();
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-cyber-accent">Loading records...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-cyber-text">Operative Dashboard</h1>
        <p className="mt-2 text-sm text-cyber-muted">Your scan history and recent operations.</p>
      </div>

      <div className="rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-6 shadow-glow">
        <h2 className="text-lg font-semibold text-cyber-text mb-4">Scan History</h2>
        
        {scans.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-cyber-line bg-cyber-bg/60 p-6 text-center text-sm text-cyber-muted">
            No scans recorded yet. Initiate a scan from the Scanner interface to see history here.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/10">
            <table className="w-full text-left text-sm text-cyber-text">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-[0.2em] opacity-70">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((scan) => (
                  <tr key={scan.id} className="border-b border-white/5 last:border-b-0">
                    <td className="px-4 py-3 font-mono text-xs text-cyber-muted whitespace-nowrap">
                      {new Date(scan.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{scan.target_url}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                          scan.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : scan.status === 'partial'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}
                      >
                        {scan.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
