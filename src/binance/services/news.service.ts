import { Injectable, Logger } from '@nestjs/common';
import { NewsItem } from '../../shared/interfaces/news.interface';
import axios from 'axios';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);
  private readonly NEWS_API_URL = process.env.NEWS_API_URL;
  private readonly NEWS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private cachedNews: NewsItem[] = [];
  private lastNewsFetch: number | null = null;

  async getNews(attempts = 3, delay = 5000): Promise<NewsItem[]> {
    // Check cache first
    if (this.isCacheValid()) {
      this.logger.debug('Returning cached news data');
      return this.cachedNews;
    }

    // Fetch new data if cache is invalid
    return this.fetchAndCacheNews(attempts, delay);
  }

  private isCacheValid(): boolean {
    return !!(
      this.lastNewsFetch &&
      Date.now() - this.lastNewsFetch < this.NEWS_CACHE_DURATION &&
      this.cachedNews.length > 0
    );
  }

  private async fetchAndCacheNews(attempts: number, delay: number): Promise<NewsItem[]> {
    for (let i = 0; i < attempts; i++) {
      try {
        this.logger.debug('Fetching news from economic calendar API');
        if (!this.NEWS_API_URL) {
          throw new Error('NEWS_API_URL is not configured');
        }

        const response = await axios.get(this.NEWS_API_URL);
        const data = response.data;

        if (!Array.isArray(data)) {
          throw new Error('Invalid news data format: Expected an array');
        }

        const newsItems = this.parseNewsData(data);
        this.updateCache(newsItems);
        
        return newsItems;

      } catch (error: any) {
        this.logger.error(`Attempt ${i + 1} failed to fetch news: ${error.message}`);
        if (i < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw new Error(`Failed to fetch news: ${error.message}`);
        }
      }
    }

    return [];
  }

  private parseNewsData(data: any[]): NewsItem[] {
    return data
      .map((item: any, index: number) => {
        const impact = item.impact === 'Holiday' ? 'HOLIDAY' : item.impact.toUpperCase();
        
        if (!['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY'].includes(impact)) {
          this.logger.warn(`Invalid impact value for event "${item.title}": ${item.impact}`);
        }

        return {
          id: `${item.title}-${item.date}-${index}`,
          title: item.title,
          timestamp: Date.parse(item.date),
          impact: impact as 'HIGH' | 'MEDIUM' | 'LOW' | 'HOLIDAY',
        };
      })
      .filter((item: NewsItem) => ['HIGH', 'MEDIUM', 'LOW', 'HOLIDAY'].includes(item.impact));
  }

  private updateCache(newsItems: NewsItem[]): void {
    this.cachedNews = newsItems;
    this.lastNewsFetch = Date.now();
    this.logger.debug(`Cached ${newsItems.length} news items`);
  }
}