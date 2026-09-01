create policy "villix_admin_delete_receipts"
on storage.objects
for delete
to authenticated
using (bucket_id = 'receipt-files' and (select private.is_villix_admin()));
