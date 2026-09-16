const admin = db.getSiblingDB("admin");
admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD);
try {
  const status = admin.runCommand({ replSetGetStatus: 1 });
  if (status.code === 94) {
    admin.runCommand({ replSetInitiate: { _id: "rs1", members: [{ _id: 0, host: "mongo:27017" }] } });
  }
} catch (error) {
  if (error.code !== 94) throw error;
  admin.runCommand({ replSetInitiate: { _id: "rs1", members: [{ _id: 0, host: "mongo:27017" }] } });
}
quit(admin.runCommand({ hello: 1 }).isWritablePrimary ? 0 : 1);
