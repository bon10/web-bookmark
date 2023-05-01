import {Database} from '@/types/schema';
import {createClient, SupabaseClient} from '@supabase/supabase-js';

export type Video = Database['public']['Tables']['videos']['Row'];

// export interface Video {
//   id: number;
//   title: string;
//   video_url: string;
//   sort_order: number;
//   rating: number;
//   created_at: string;
//   updated_at: string;
// }

export interface Thumbnail {
  id: number;
  video_id: number;
  url: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  video_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
