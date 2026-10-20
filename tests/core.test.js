import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWeights,drawPrize,expectedCost,DEFAULT_WEIGHTS} from '../src/core.js';

test('probabilidades por prémio e custo esperado',()=>{
  assert.deepEqual(validateWeights([70,20,8,2]),DEFAULT_WEIGHTS);
  assert.equal(expectedCost(DEFAULT_WEIGHTS),8.1);
  assert.deepEqual([0,7000,8999,9799,9999].map(n=>drawPrize(DEFAULT_WEIGHTS,()=>n)),[5,10,10,20,50]);
});
test('a validação rejeita totais ou casas decimais incorretas',()=>{
  assert.throws(()=>validateWeights([50,20,20,11]));
  assert.throws(()=>validateWeights([99.999,0,0,0.001]));
  assert.throws(()=>validateWeights([100,-1,1,0]));
  assert.deepEqual(validateWeights([0,0,0,100]),[0,0,0,10000]);
});
