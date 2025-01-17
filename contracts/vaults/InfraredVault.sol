// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

// import "hardhat/console.sol";

import "../interfaces/IStakingPool.sol";
import "./Vault.sol";

contract InfraredVault is Vault {

  IStakingPool public stakingPool;

  constructor(
    address _protocol,
    address _settings,
    address _redeemPoolFactory,
    address _bribesPoolFactory,
    address _stakingPool_,
    address _assetToken_,
    string memory _pTokenName, string memory _pTokensymbol
  ) Vault(_protocol, _settings, _redeemPoolFactory, _bribesPoolFactory, _assetToken_, _pTokenName, _pTokensymbol) {
    require(_stakingPool_ != address(0), "Zero address detected");
    
    stakingPool = IStakingPool(_stakingPool_);
    _assetToken.approve(address(stakingPool), type(uint256).max);
  }

  /* ========== INTERNAL FUNCTIONS ========== */

  function _balanceOfUnderlyingVault() internal view override returns (uint256) {
    return stakingPool.balanceOf(address(this));
  }

  function _depositToUnderlyingVault(uint256 amount) internal override {
    stakingPool.stake(amount);
  }

  function _withdrawFromUnderlyingVault(uint256 amount) internal override {
    stakingPool.withdraw(amount);
  }

  function _getRewardsFromUnderlyingVault() internal override {
    uint256 epochId = currentEpochId();

    IBribesPool stakingBribesPool = IBribesPool(_epochs[epochId].stakingBribesPool);
    // Keep bribes unclaimed, if nobody swapped for YT yet in this epoch
    if (stakingBribesPool.totalSupply() == 0) {
      return;
    }

    uint256 rewardTokensCount = 0;
    while(true) {
      try stakingPool.rewardTokens(rewardTokensCount) returns (address) {
        rewardTokensCount++;
      } catch {
        break;
      }
    }

    address[] memory rewardTokens = new address[](rewardTokensCount);
    for (uint256 i = 0; i < rewardTokens.length; i++) {
      rewardTokens[i] = stakingPool.rewardTokens(i);
    }

    stakingPool.getReward();

    for (uint256 i = 0; i < rewardTokens.length; i++) {
      address bribeToken = rewardTokens[i];
      uint256 allBribes = IERC20(bribeToken).balanceOf(address(this));

      // Add bribes to auto bribes pool
      if (allBribes > 0) {
        IERC20(bribeToken).approve(address(stakingBribesPool), allBribes);
        stakingBribesPool.addBribes(bribeToken, allBribes);
      }
    }
  }

  function _exitUnderlyingVault() internal override {
    stakingPool.exit();
  }

}