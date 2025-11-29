-- 在 Supabase SQL Editor 中运行此 SQL 以创建向量搜索函数

create or replace function match_policy_chunks (
  query_embedding vector(3072),
  match_threshold float,
  match_count int
)
returns table (
  id bigint,
  policy_id text,
  chunk_text text,
  product_type text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    policy_chunks.id,
    policy_chunks.policy_id,
    policy_chunks.chunk_text,
    policy_chunks.product_type,
    1 - (policy_chunks.embedding <=> query_embedding) as similarity
  from policy_chunks
  where 1 - (policy_chunks.embedding <=> query_embedding) > match_threshold
  order by policy_chunks.embedding <=> query_embedding
  limit match_count;
end;
$$;
