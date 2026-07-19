export const SEARCH_URLS = {
  linkedin: (keywords: string) =>
    `https://www.linkedin.com/jobs/search/?${new URLSearchParams({ keywords, f_AL: "true" }).toString()}`,
  indeed: (keywords: string) =>
    `https://www.indeed.com/jobs?${new URLSearchParams({ q: keywords }).toString()}`,
} as const;
