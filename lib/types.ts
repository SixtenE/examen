export type QueryStatus = "pending" | "processing" | "ready" | "failed";

export type QueryListItem = {
  id: string;
  title: string;
  image_key: string;
  status: QueryStatus;
  createdAt: string;
};

export type QueryDetail = QueryListItem & {
  image_url: string;
};

export type MatchItem = {
  id: string;
  query_id: string;
  auctionet_id: string;
  image_url: string;
  title: string;
  price: number;
  currency: string;
  similarity_score: number;
  createdAt: string;
};

export type QueriesPage = {
  items: QueryListItem[];
  nextCursor: string | null;
};
