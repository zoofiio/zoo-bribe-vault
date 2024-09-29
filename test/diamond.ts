import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import {
  DiamondCutFacet, DiamondLoupeFacet,
  DiamondCutFacet__factory, DiamondLoupeFacet__factory,
  MockDiamond__factory,
  DiamondInit__factory,
} from "../typechain";

const { getSelectors, FacetCutAction, removeSelectors, findAddressPositionInFacets } = require('../scripts/diamond.js')

async function deployDiamond() {
  const [Alice] = await ethers.getSigners();

  // deploy DiamondCutFacet
  const DiamondCutFacetFactory = await ethers.getContractFactory('DiamondCutFacet');
  const DiamondCutFacet = await DiamondCutFacetFactory.deploy();
  const diamondCutFacet = DiamondCutFacet__factory.connect(await DiamondCutFacet.getAddress(), ethers.provider);
  console.log('DiamondCutFacet deployed:', await diamondCutFacet.getAddress());

  // deploy Diamond
  const MockDiamondFactory = await ethers.getContractFactory('MockDiamond');
  const MockDiamond = await MockDiamondFactory.deploy(Alice.address, await diamondCutFacet.getAddress());
  const diamond = MockDiamond__factory.connect(await MockDiamond.getAddress(), ethers.provider);
  console.log('MockDiamond deployed:', await diamond.getAddress());

  // deploy DiamondInit
  // DiamondInit provides a function that is called when the diamond is upgraded to initialize state variables
  // Read about how the diamondCut function works here: https://eips.ethereum.org/EIPS/eip-2535#addingreplacingremoving-functions
  const DiamondInitFactory = await ethers.getContractFactory('DiamondInit');
  const DiamondInit = await DiamondInitFactory.deploy();
  const diamondInit = DiamondInit__factory.connect(await DiamondInit.getAddress(), ethers.provider);
  console.log('DiamondInit deployed:', await diamondInit.getAddress());

  // deploy facets
  console.log('Deploying facets');
  const FacetNames = [
    'DiamondLoupeFacet',
  ];
  const cut = [];
  for (const FacetName of FacetNames) {
    const FacetFactory = await ethers.getContractFactory(FacetName);
    const Facet = await FacetFactory.deploy();
    console.log(`${FacetName} deployed: ${await Facet.getAddress()}`);
    cut.push({
      facetAddress: await Facet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: getSelectors(Facet)
    });
  }

  // upgrade diamond with facets
  console.log('Diamond Cut:', cut)
  const diamondCut = await ethers.getContractAt('IDiamondCut', await diamond.getAddress());
  let tx;
  let receipt;
  // call to init function
  let functionCall = diamondInit.interface.encodeFunctionData('init');
  tx = await diamondCut.diamondCut(cut, await diamondInit.getAddress(), functionCall);
  console.log('Diamond cut tx: ', tx.hash);
  receipt = await tx.wait();
  if (!receipt!.status) {
    throw Error(`Diamond upgrade failed: ${tx.hash}`);
  }
  console.log('Completed diamond cut');

  return await diamond.getAddress();
}

describe('Diamonds', () => {

  let diamondAddress: string;
  let diamondCutFacet: DiamondCutFacet;
  let diamondLoupeFacet: DiamondLoupeFacet;
  let addresses: string[];

  before(async () => {
    await deployDiamond();

    diamondAddress = await deployDiamond();
    diamondCutFacet = DiamondCutFacet__factory.connect(diamondAddress, ethers.provider);
    diamondLoupeFacet = DiamondLoupeFacet__factory.connect(diamondAddress, ethers.provider);

    addresses = await diamondLoupeFacet.facetAddresses();
  });

  it('should have two facets -- call to facetAddresses function', async () => {
    expect(await diamondLoupeFacet.facetAddresses()).to.have.lengthOf(2);
  });

  it('facets should have the right function selectors -- call to facetFunctionSelectors function', async () => {
    // let addresses = await diamondLoupeFacet.facetAddresses();
    let result = await diamondLoupeFacet.facetFunctionSelectors(addresses[0]);
    let selectors = getSelectors(diamondCutFacet);
    // console.log('result:', result);
    // console.log('expected selectors:', selectors);
    expect(result).to.deep.equal(selectors);

    selectors = getSelectors(diamondLoupeFacet);
    result = await diamondLoupeFacet.facetFunctionSelectors(addresses[1]);
    // console.log('result:', result);
    // console.log('expected selectors:', selectors);
    expect(result).to.deep.equal(selectors);
  });

  it('selectors should be associated to facets correctly -- multiple calls to facetAddress function', async () => {
    // let addresses = await diamondLoupeFacet.facetAddresses();

    expect(await diamondLoupeFacet.facetAddress('0x1f931c1c')).to.equal(addresses[0]);  // diamondCut
    expect(await diamondLoupeFacet.facetAddress('0xcdffacc6')).to.equal(addresses[1]);  // facetAddress
    expect(await diamondLoupeFacet.facetAddress('0x01ffc9a7')).to.equal(addresses[1]);  // supportsInterface
  });

  it('should add test1 functions', async () => {
    const [Alice] = await ethers.getSigners();

    const Test1Facet = await ethers.getContractFactory('MockFacet1');
    const test1Facet = await Test1Facet.deploy();

    const selectors = getSelectors(test1Facet).remove(['supportsInterface'])
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: await test1Facet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 }
    );

    let receipt = await tx.wait()
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`);
    }
    let result = await diamondLoupeFacet.facetFunctionSelectors(await test1Facet.getAddress());
    expect(result).to.deep.equal(selectors);

    addresses = await diamondLoupeFacet.facetAddresses();
    // console.log('addresses', addresses);
  });

  it('should test function call', async () => {
    const test1Facet = await ethers.getContractAt('MockFacet1', diamondAddress);
    await test1Facet.test1Func10()
  });

  it('should replace supportsInterface function', async () => {
    const [Alice] = await ethers.getSigners();

    const Test1Facet = await ethers.getContractFactory('MockFacet1');
    const selectors = getSelectors(Test1Facet).get(['supportsInterface']);
    const testFacetAddress = addresses[2];
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: testFacetAddress,
        action: FacetCutAction.Replace,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 });
    let receipt = await tx.wait();
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`);
    };
    let result = await diamondLoupeFacet.facetFunctionSelectors(testFacetAddress);
    expect(getSelectors(Test1Facet)).to.have.same.members(result);
  });

  it('should add test2 functions', async () => {
    const [Alice] = await ethers.getSigners();

    const Test2Facet = await ethers.getContractFactory('MockFacet2');
    const test2Facet = await Test2Facet.deploy();

    const selectors = getSelectors(test2Facet);
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: await test2Facet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 }
    );
    let receipt = await tx.wait();
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`);
    }
    
    let result = await diamondLoupeFacet.facetFunctionSelectors(await test2Facet.getAddress());
    expect(selectors).to.have.same.members(result);

    addresses = await diamondLoupeFacet.facetAddresses();
  });

  it('should remove some test2 functions', async () => {
    const [Alice] = await ethers.getSigners();

    const test2Facet = await ethers.getContractAt('MockFacet2', diamondAddress);
    const functionsToKeep = ['test2Func1()', 'test2Func5()', 'test2Func6()', 'test2Func19()', 'test2Func20()'];
    const selectors = getSelectors(test2Facet).remove(functionsToKeep);
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: ethers.ZeroAddress,
        action: FacetCutAction.Remove,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 })
    let receipt = await tx.wait()
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`)
    }
    let result = await diamondLoupeFacet.facetFunctionSelectors(addresses[3]);
    expect(getSelectors(test2Facet).get(functionsToKeep)).to.have.same.members(result);
  });

  it('should remove some test1 functions', async () => {
    const [Alice] = await ethers.getSigners();
    const test1Facet = await ethers.getContractAt('MockFacet1', diamondAddress);
    const functionsToKeep = ['test1Func2()', 'test1Func11()', 'test1Func12()'];
    const selectors = getSelectors(test1Facet).remove(functionsToKeep);
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: ethers.ZeroAddress,
        action: FacetCutAction.Remove,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 }
    );
    let receipt = await tx.wait();
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`)
    }
    let result = await diamondLoupeFacet.facetFunctionSelectors(addresses[2]);
    expect(getSelectors(test1Facet).get(functionsToKeep)).to.have.same.members(result);
  });

  it('remove all functions and facets except \'diamondCut\' and \'facets\'', async () => {
    const [Alice] = await ethers.getSigners();

    let selectors = [];
    let facets = await diamondLoupeFacet.facets();
    for (let i = 0; i < facets.length; i++) {
      selectors.push(...facets[i].functionSelectors)
    }
    selectors = removeSelectors(selectors, ['facets()', 'diamondCut(tuple(address,uint8,bytes4[])[],address,bytes)'])
    let tx = await diamondCutFacet.connect(Alice).diamondCut(
      [{
        facetAddress: ethers.ZeroAddress,
        action: FacetCutAction.Remove,
        functionSelectors: selectors
      }],
      ethers.ZeroAddress, '0x', { gasLimit: 800000 }
    );
    let receipt = await tx.wait()
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`)
    }
    facets = await diamondLoupeFacet.facets();
    expect(facets).to.have.lengthOf(2);
    expect(facets[0][0]).to.equal(addresses[0]);
    expect(['0x1f931c1c']).to.have.same.members(facets[0][1]);
    expect(facets[1][0]).to.equal(addresses[1]);
    expect(['0x7a0ed627']).to.have.same.members(facets[1][1]);
  });


  it('add most functions and facets', async () => {
    const [Alice] = await ethers.getSigners();

    const diamondLoupeFacetSelectors = getSelectors(diamondLoupeFacet).remove(['supportsInterface']);
    const Test1Facet = await ethers.getContractFactory('MockFacet1');
    const Test2Facet = await ethers.getContractFactory('MockFacet2');
    // Any number of functions from any number of facets can be added/replaced/removed in a
    // single transaction
    const cut = [
      {
        facetAddress: addresses[1],
        action: FacetCutAction.Add,
        functionSelectors: diamondLoupeFacetSelectors.remove(['facets'])
      },
      {
        facetAddress: addresses[2],
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(Test1Facet)
      },
      {
        facetAddress: addresses[3],
        action: FacetCutAction.Add,
        functionSelectors: getSelectors(Test2Facet)
      }
    ]
    let tx = await diamondCutFacet.connect(Alice).diamondCut(cut, ethers.ZeroAddress, '0x', { gasLimit: 8000000 })
    let receipt = await tx.wait();
    if (!receipt!.status) {
      throw Error(`Diamond upgrade failed: ${tx.hash}`)
    }
    const facets = await diamondLoupeFacet.facets();
    const facetAddresses = await diamondLoupeFacet.facetAddresses();
    expect(facetAddresses).to.have.lengthOf(4);
    expect(facets).to.have.lengthOf(4);
    expect(facetAddresses).to.deep.equal(addresses);
    expect(facets[0][0]).to.equal(addresses[0]);
    expect(facets[1][0]).to.equal(addresses[1]);
    expect(facets[2][0]).to.equal(addresses[2]);
    expect(facets[3][0]).to.equal(addresses[3]);

    expect(getSelectors(diamondCutFacet)).to.have.same.members(facets[findAddressPositionInFacets(addresses[0], facets)][1]);
    expect(diamondLoupeFacetSelectors).to.have.same.members(facets[findAddressPositionInFacets(addresses[1], facets)][1]);
    expect(getSelectors(Test1Facet)).to.have.same.members(facets[findAddressPositionInFacets(addresses[2], facets)][1]);
    expect(getSelectors(Test2Facet)).to.have.same.members(facets[findAddressPositionInFacets(addresses[3], facets)][1]);
  })

});
