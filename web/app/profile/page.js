import { redirect } from 'next/navigation';
import { auth } from 'thepopebot/auth';
import { ProfileInfoPage } from 'thepopebot/chat';
import { getUserById } from 'thepopebot/db/users';

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');
  const profile = getUserById(session.user.id);
  return <ProfileInfoPage profile={profile} />;
}
