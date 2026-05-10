import { createClient } from "@/lib/supabase/client";

export type ConversationRow = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export async function listConversations(): Promise<ConversationRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("listConversations:", error);
    return [];
  }
  return data ?? [];
}

export async function createConversation(title: string): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title: title.slice(0, 60) })
    .select("id")
    .single();
  if (error) {
    console.error("createConversation:", error);
    return null;
  }
  return data.id;
}

export async function loadMessages(conversationId: string): Promise<MessageRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("loadMessages:", error);
    return [];
  }
  return (data ?? []) as MessageRow[];
}

export async function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content });
  if (error) console.error("saveMessage:", error);
}

export async function deleteConversation(conversationId: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);
  if (error) {
    console.error("deleteConversation:", error);
    return false;
  }
  return true;
}
