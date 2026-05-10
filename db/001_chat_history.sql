-- LawTax: 대화 이력 저장 스키마
-- Supabase SQL Editor에서 실행하세요.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at);

-- 메시지 추가 시 conversations.updated_at 자동 갱신
create or replace function public.touch_conversation()
returns trigger language plpgsql as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation();

-- Row Level Security
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "own conversations select" on public.conversations
  for select using (auth.uid() = user_id);
create policy "own conversations insert" on public.conversations
  for insert with check (auth.uid() = user_id);
create policy "own conversations update" on public.conversations
  for update using (auth.uid() = user_id);
create policy "own conversations delete" on public.conversations
  for delete using (auth.uid() = user_id);

create policy "own messages select" on public.messages
  for select using (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  );
create policy "own messages insert" on public.messages
  for insert with check (
    exists (select 1 from public.conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  );
