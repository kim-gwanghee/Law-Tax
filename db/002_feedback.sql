-- LawTax: 답변 피드백 + 사용량 로그
-- Supabase SQL Editor에서 실행하세요.

-- 답변 피드백
create table public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),  -- 1: 👍, -1: 👎
  comment text,
  created_at timestamptz default now(),
  unique (message_id, user_id)
);

create index message_feedback_user_idx on public.message_feedback(user_id, created_at desc);
create index message_feedback_rating_idx on public.message_feedback(rating, created_at desc);

alter table public.message_feedback enable row level security;

create policy "own feedback select" on public.message_feedback
  for select using (auth.uid() = user_id);
create policy "own feedback insert" on public.message_feedback
  for insert with check (auth.uid() = user_id);
create policy "own feedback update" on public.message_feedback
  for update using (auth.uid() = user_id);
create policy "own feedback delete" on public.message_feedback
  for delete using (auth.uid() = user_id);

-- 사용량 이벤트 로그
create table public.usage_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,    -- 'query_submitted', 'law_clicked', 'feedback_given' 등
  metadata jsonb,
  created_at timestamptz default now()
);

create index usage_events_user_idx on public.usage_events(user_id, created_at desc);
create index usage_events_type_idx on public.usage_events(event_type, created_at desc);

alter table public.usage_events enable row level security;

create policy "own usage select" on public.usage_events
  for select using (auth.uid() = user_id);
create policy "own usage insert" on public.usage_events
  for insert with check (auth.uid() = user_id);
