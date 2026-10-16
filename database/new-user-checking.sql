select u.email as member_email, o.email as owner_email, m.can_approve
from public.workspace_members m
left join auth.users u on u.id = m.member_id
left join auth.users o on o.id = m.owner_id;
