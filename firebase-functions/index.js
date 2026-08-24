const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.database();
const bucket = admin.storage().bucket();

const ROLE_ALIASES = {
  secretary: ["secretary", "admin", "secratary"],
  supervisor: ["supervisor"],
  guard: ["guard", "security", "securityguard", "security_guard"],
  resident: ["resident", "residents"]
};
function norm(v){ return String(v || "").trim().toLowerCase(); }
function compact(v){ return norm(v).replace(/[^a-z0-9]/g, ""); }
function roleMatches(obj, path, role){
  const aliases = ROLE_ALIASES[role] || [role];
  const explicit = compact(obj && (obj.role || obj.userRole || obj.userrole || obj.type || obj.userType));
  const p = compact(path);
  return aliases.some(a => explicit.includes(compact(a)) || p.includes(compact(a)));
}
function identityMatches(obj, email, uid){
  if (!obj || typeof obj !== "object") return false;
  const e = norm(obj.email || obj.Email || obj.userEmail || obj.registeredEmail);
  const u = String(obj.uid || obj.userId || obj.userUID || obj.authUid || "");
  return (e && e === norm(email)) || (u && u === uid);
}
function collectUserPaths(node, email, uid, role, path=""){
  const paths=[];
  if(!node || typeof node!=="object") return paths;
  if(identityMatches(node,email,uid) && roleMatches(node,path,role)){
    paths.push(path); return paths;
  }
  for(const [k,v] of Object.entries(node)){
    if(v && typeof v==="object") paths.push(...collectUserPaths(v,email,uid,role,path+"/"+k));
  }
  return paths;
}
function isSecretaryProfile(profile,email,role){
  return role==="secretary" && profile && norm(profile.email || profile.Email)===norm(email);
}
async function deleteOwnedStorage(uid,email){
  const [files]=await bucket.getFiles();
  const deletions=[];
  for(const file of files){
    const [meta]=await file.getMetadata().catch(()=>[{}]);
    const md=meta.metadata || {};
    const ownerUid=String(md.ownerUid || md.uid || "");
    const ownerEmail=norm(md.ownerEmail || md.email || "");
    const pathUid=file.name.includes(`/users/${uid}/`) || file.name.startsWith(`users/${uid}/`);
    if(ownerUid===uid || (ownerEmail && ownerEmail===norm(email)) || pathUid) deletions.push(file.delete().catch(()=>null));
  }
  await Promise.all(deletions);
  return deletions.length;
}

exports.deleteSentryAccount = functions.https.onCall(async (data, context) => {
  if(!context.auth) throw new functions.https.HttpsError("unauthenticated","Please verify your Sentry24x7 account first.");
  const uid=context.auth.uid;
  const tokenEmail=norm(context.auth.token.email);
  const role=norm(data && data.role);
  const societyId=String(data && data.societyId || "").trim();
  if(!tokenEmail || !societyId || !ROLE_ALIASES[role]) throw new functions.https.HttpsError("invalid-argument","Missing or invalid account information.");

  const user=await admin.auth().getUser(uid);
  if(norm(user.email)!==tokenEmail) throw new functions.https.HttpsError("permission-denied","Authenticated email mismatch.");

  const societyRef=db.ref(`AGCS/${societyId}`);
  const snap=await societyRef.once("value");
  if(!snap.exists()) throw new functions.https.HttpsError("not-found","Society not found.");
  const society=snap.val() || {};
  const profile=society.Profile || society.profile || null;
  const secretaryMatch=isSecretaryProfile(profile,tokenEmail,role);
  const paths=collectUserPaths(society,tokenEmail,uid,role,"").filter(Boolean);
  if(!secretaryMatch && !paths.length) throw new functions.https.HttpsError("permission-denied","The authenticated user was not found under the selected society and role.");

  const updates={};
  // Delete matched personal/account records, but never delete the whole society root.
  for(const p of paths){
    const clean=p.replace(/^\/+/,"");
    if(clean && clean!=="Profile" && clean!=="profile") updates[clean]=null;
  }
  // If the authenticated account is the secretary/admin represented in Profile,
  // remove only that person's identifying fields. Keep the society itself intact.
  if(secretaryMatch){
    const key=society.Profile ? "Profile" : "profile";
    for(const f of ["email","Email","secretaryName","secrataryname","secrataryName","secretary","uid","userId","userUID","authUid"]){
      if(profile && Object.prototype.hasOwnProperty.call(profile,f)) updates[`${key}/${f}`]=null;
    }
  }

  if(Object.keys(updates).length) await societyRef.update(updates);
  let storageDeleted=0;
  try{ storageDeleted=await deleteOwnedStorage(uid,tokenEmail); }catch(e){ console.error("Storage cleanup warning",e); }

  // Delete Authentication LAST. If database cleanup fails, the user can still retry.
  await admin.auth().deleteUser(uid);
  return {success:true,databaseRecordsDeleted:Object.keys(updates).length,storageFilesDeleted:storageDeleted};
});
