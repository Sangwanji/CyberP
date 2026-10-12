import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Link, useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 rounded-[2rem] border border-cyber-line bg-cyber-panel/90 p-8 shadow-glow">
        <div>
          <h2 className="text-center text-3xl font-black tracking-tight text-cyber-text">
            System Access
          </h2>
          <p className="mt-2 text-center text-sm text-cyber-muted">
            Enter your credentials to continue
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={(e) => void handleLogin(e)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-cyber-text">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-cyber-line bg-cyber-bg/80 px-4 py-3 text-sm text-cyber-text outline-none transition focus:border-cyber-accent focus:ring-2 focus:ring-cyber-accent/30"
                placeholder="operator@cyberp.local"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-cyber-text">Passcode</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-2xl border border-cyber-line bg-cyber-bg/80 px-4 py-3 text-sm text-cyber-text outline-none transition focus:border-cyber-accent focus:ring-2 focus:ring-cyber-accent/30"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && <div className="text-sm text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-cyber-accent px-4 py-3 text-sm font-semibold text-cyber-bg transition duration-200 hover:bg-cyber-accentSoft hover:shadow-glow focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Authenticating...' : 'Initialize Session'}
          </button>
          <div className="text-center text-sm text-cyber-muted">
            Don't have clearance?{' '}
            <Link to="/signup" className="text-cyber-accent hover:underline">
              Request Access
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
