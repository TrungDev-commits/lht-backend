export interface RssSourceConfig {
  name: string;
  url: string;
  category: 'Tech' | 'AI' | 'Market' | 'VN Tech' | 'DevOps';
  lang: 'vi' | 'en';
}

export const RSS_SOURCES: RssSourceConfig[] = [
  {
    name: 'TechCrunch',
    url: 'https://feeds.feedburner.com/TechCrunch',
    category: 'Tech',
    lang: 'en',
  },
  {
    name: 'HackerNews Top',
    url: 'https://hnrss.org/frontpage',
    category: 'Tech',
    lang: 'en',
  },
  {
    name: 'VNExpress Số Hóa',
    url: 'https://vnexpress.net/rss/so-hoa.rss',
    category: 'VN Tech',
    lang: 'vi',
  },
  {
    name: 'VnEconomy Công Nghệ',
    url: 'https://vneconomy.vn/rss/cong-nghe.rss',
    category: 'Market',
    lang: 'vi',
  },
  {
    name: 'Dev.to Top',
    url: 'https://dev.to/feed',
    category: 'DevOps',
    lang: 'en',
  },
];
