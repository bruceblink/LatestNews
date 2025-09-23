import prisma from "#/lib/prisma.ts";

async function main() {
  const startTime = performance.now();

  // Learn more about caching strategies:
  // https://www.prisma.io/docs/accelerate/caching
  const cachedUsersWithUserIdentities = await prisma.user_info.findMany({
    where: {
      email: { contains: "alice" },
    },
    include: { user_identities: true },
  });

  const endTime = performance.now();

  // Calculate the elapsed time
  const elapsedTime = endTime - startTime;

  console.log(`The query took ${elapsedTime}ms.`);
  console.log("It returned the following data: \n", cachedUsersWithUserIdentities);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
