const test=require('node:test'),assert=require('node:assert/strict');
const {validateStaging}=require('../ql/start-integrated-staging.cjs');
const env={APP_URL:'https://mudroom-ql-integrated-oct14.onrender.com',JWT_SECRET:'test-only-secret',QL_PREVIEW_PASSWORD:'test-only-password',QL_REQUIRE_DURABLE_STORAGE:'1'};
test('staging refuses an ordinary ephemeral directory',()=>assert.throws(()=>validateStaging(env,'1 2 3 / / rw','/opt/render/project/src/data'),/mounted volume/));
test('staging accepts the exact persistent data mount',()=>assert.doesNotThrow(()=>validateStaging(env,'1 2 3 / /opt/render/project/src/data rw','/opt/render/project/src/data')));
test('staging rejects production URL and production billing credentials',()=>{assert.throws(()=>validateStaging({...env,APP_URL:'https://thepottersmudroom.com'},'','/data'),/isolated/);assert.throws(()=>validateStaging({...env,STRIPE_SECRET_KEY:'test-only'},'','/data'),/production billing/);});
