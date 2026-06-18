// Types for Hermes Atlas data
export interface Repo {
  owner: string;
  repo: string;
  name: string;
  description: string;
  stars: number;
  url: string;
  official: boolean;
  category: string;
}

export interface Summary {
  summary: string;
  highlights: string[];
  readmeHash?: string;
  generatedAt?: string;
  model?: string;
  version?: number;
  audit?: string;
}

export interface ListEntry {
  slug: string;
  title: string;
  description: string;
  filter: {
    category?: string;
    tag?: string;
  };
}

export interface ListSummary {
  entries: Record<string, string>;
}

export interface FeaturedRepo {
  slug: string;
  weekStart: string;
  addedAt: string;
}

export interface LatestRelease {
  version: string;
  [key: string]: string;
}

export interface AtlasData {
  repos: Repo[];
  summaries: Record<string, Summary>;
  lists: ListEntry[];
  listSummaries: Record<string, ListSummary>;
  featured: FeaturedRepo[];
  latestRelease: LatestRelease;
  handbookMentions: Record<string, unknown>;
  reports: unknown[];
}
