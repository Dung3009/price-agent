export interface NewsItem {
  id: string;
  title: string;
  timestamp: number; // Unix timestamp in ms
  impact: 'HIGH' | 'MEDIUM' | 'LOW' | 'HOLIDAY';
}