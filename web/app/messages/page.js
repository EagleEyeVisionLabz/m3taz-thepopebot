import { auth } from 'thepopebot/auth';
import { MessagesPage } from 'thepopebot/chat';

export default async function MessagesRoute() {
  const session = await auth();
  return <MessagesPage session={session} />;
}
