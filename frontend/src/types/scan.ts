export interface NmapPort {
  port: number;
  protocol: string;
  state: string;
  service: string;
  version: string;
}

export interface NmapReport {
  ports: NmapPort[];
  nmapStatus: 'success' | 'unavailable' | 'error';
  note: string;
}

export interface ScanResponse {
  status: 'success' | 'partial';
  message: string;
  targetUrl: string;
  upstreamStatus: number | null;
  headers: HeaderReport[];
  whois: WhoisReport;
  certificate: CertificateReport;
  nmap: NmapReport;
}

export interface HeaderReport {
  header: string;
  status: 'Present' | 'Missing';
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface CertificateReport {
  issuer: string;
  validFrom: string | null;
  expiryDate: string | null;
  daysRemaining: number | null;
  tlsVersion: string | null;
  expiryStatus: 'valid' | 'expiring-soon' | 'expired' | 'unavailable';
  note: string;
}

export interface WhoisReport {
  registrar: string;
  creationDate: string | null;
  expiryDate: string | null;
  updatedDate: string | null;
  nameServers: string[];
  organization: string;
  whoisStatus: 'available' | 'private' | 'unavailable';
  note: string;
}