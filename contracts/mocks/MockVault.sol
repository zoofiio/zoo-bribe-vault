// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/IBribesPool.sol";
import "../interfaces/IProtocolSettings.sol";
import "../interfaces/IPToken.sol";
import "../interfaces/IVault.sol";
import "../libs/Constants.sol";
import "../libs/TokensTransfer.sol";
import "../thirdparty/infrared/interfaces/IInfraredStakingPool.sol";
import "../tokens/PToken.sol";
import "../vaults/RedeemPool.sol";

contract MockVault is IVault {
  address public immutable settings;
  IInfraredStakingPool public immutable stakingPool;

  IERC20 internal immutable _assetToken;
  IPToken internal immutable _pToken;

  constructor(
    address _protocol,
    address _settings,
    address _stakingPool_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) {
    settings = _settings;
    stakingPool = IInfraredStakingPool(_stakingPool_);

    _assetToken = IERC20(_assetToken_);
    _pToken = new PToken(_protocol, _settings, _pTokenName, _pTokensymbol, IERC20Metadata(_assetToken_).decimals());
  }

  /* ========== IVault Functions ========== */

  function currentEpochId() public pure returns (uint256) {
    return 0;
  }

  function epochInfoById(uint256) public pure returns (Constants.Epoch memory) {
    return Constants.Epoch(0, 0, 0, address(0), address(0), address(0));
  }

  function assetToken() public view override returns (address) {
    return address(_assetToken);
  }

  function redeemAssetToken() public view returns (address) {
    return address(_assetToken);
  }
  
  function assetBalance() public pure returns (uint256) {
    return 0;
  }

  function pToken() public view override returns (address) {
    return address(_pToken);
  }

  function paramValue(bytes32) public pure returns (uint256) {
    return 0;
  }

  function yTokenTotalSupply(uint256) public pure returns (uint256) {
    return 0;
  }

  function yTokenUserBalance(uint256, address) public pure returns (uint256) {
    return 0;
  }

  function epochNextSwapX(uint256) external pure returns (uint256) {
    return 0;
  }

  function epochNextSwapK0(uint256) external pure returns (uint256) {
    return 0;
  }

  /* ========== Mock Functions ========== */

  function mockNotifyYTSwappedForUser(IBribesPool bribesPool, address user, uint256 yTokenAmount) external {
    bribesPool.notifyYTSwappedForUser(user, yTokenAmount);
  }

  function mockAddBribes(IBribesPool bribesPool, address bribeToken, uint256 bribesAmount) external {
    TokensTransfer.transferTokens(bribeToken, msg.sender, address(this), bribesAmount);
    IERC20(bribeToken).approve(address(bribesPool), bribesAmount);
    bribesPool.addBribes(bribeToken, bribesAmount);
  }

  function mockSwap(uint256 amount) external {
    TokensTransfer.transferTokens(address(_assetToken), msg.sender, address(this), amount);
    // stakingPool.stake(amount);

    IPToken(_pToken).rebase(amount);
  }

  function mockDepoit(uint256 amount) external {
    TokensTransfer.transferTokens(address(_assetToken), msg.sender, address(this), amount);
    // stakingPool.stake(amount);

    // mint pToken to user
    uint256 pTokenAmount = amount;
    IPToken(_pToken).mint(msg.sender, pTokenAmount);
  }

  function mockEndEpoch(address _redeemPool_) external {
    RedeemPool redeemPool = RedeemPool(_redeemPool_);

    uint256 amount = redeemPool.totalRedeemingBalance();
    if (amount > 0) {
      IPToken(_pToken).burn(address(redeemPool), amount);
      // stakingPool.withdraw(amount);
      TokensTransfer.transferTokens(address(_assetToken), address(this), address(redeemPool), amount);
    }
    
    redeemPool.notifySettlement(amount);
  }

}