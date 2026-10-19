-- image-variants (S-08), review fixes F1 and F2. Forward-only:
-- 20261017120000_image_variants.sql may already be applied in production.
--
-- F1 — an image variant may only reference an object owned by its study's
-- author, on every write path:
--   * the owner check lived only inside create_study / update_study_draft
--     (jsonb). The draft-only RLS policies on variants plus the column grants
--     on (kind, image_path) let an author write a draft's image_path directly
--     through PostgREST and point it at another author's unreferenced object;
--     after start, the ballot would sign that object with the secret key.
--   * a BEFORE INSERT / UPDATE trigger now refuses such a row with 23514, the
--     same code the RPCs use. It compares against the study's author, not
--     auth.uid(), so it holds for the security definer update_study_draft too.
--   * create_study is security invoker and inserts (kind, image_path) as the
--     caller, so the insert grant stays. Nothing updates those columns
--     directly (update_study_draft is security definer), so the update grant
--     is revoked.
--
-- F2 — an object a variant references is immutable:
--   * the delete policy allowed removing an own object that a started study's
--     variant still referenced, and insert checked only the name, so an author
--     could swap an image mid-vote (remove + re-upload under the same name),
--     and two concurrent draft edits could delete an object the other one
--     kept. Delete and insert now also require that no variant references the
--     name. The app removes only objects no variant references any more (after
--     update_study_draft replaced them, after the study row is deleted, or
--     after a failed RPC), so its cleanup is unaffected.
--   * the check reads every author's variants, so it is a security definer
--     helper in the `private` schema, which PostgREST does not expose (an
--     "is this name in use" oracle must not be an RPC).

-- ---------------------------------------------------------------------------
-- F1: variant -> object ownership on every write path
-- ---------------------------------------------------------------------------

create function public.variants_image_owner_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.image_path is not null and not exists (
    select 1
      from storage.objects o
      join public.studies s on s.id = new.study_id
     where o.bucket_id = 'variant-images'
       and o.name = new.image_path
       and o.owner_id = s.author_id::text
  ) then
    raise exception 'variants: the image is missing or not owned by the study''s author'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function public.variants_image_owner_check() from public, anon, authenticated;

create trigger variants_image_owner_check
  before insert or update of image_path, study_id on public.variants
  for each row execute function public.variants_image_owner_check();

revoke update (kind, image_path) on public.variants from authenticated;

-- ---------------------------------------------------------------------------
-- F2: referenced objects cannot be deleted or re-created
-- ---------------------------------------------------------------------------

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.variant_image_in_use(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.variants v where v.image_path = p_name);
$$;

revoke execute on function private.variant_image_in_use(text) from public, anon;
grant execute on function private.variant_image_in_use(text) to authenticated;

drop policy "variant-images: authors insert" on storage.objects;
create policy "variant-images: authors insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'variant-images'
    and name ~ '^[0-9a-f-]{36}\.(webp|jpg)$'
    and not private.variant_image_in_use(name)
  );

drop policy "variant-images: authors delete own" on storage.objects;
create policy "variant-images: authors delete own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'variant-images'
    and owner_id = (select auth.uid()::text)
    and not private.variant_image_in_use(name)
  );
