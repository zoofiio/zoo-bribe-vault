// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import "../interfaces/OracleInterface.sol";
import "../libs/Constants.sol";
import "../settings/ProtocolOwner.sol";

/**
 * @dev Updated from https://github.com/VenusProtocol/oracle/blob/develop/contracts/oracles/ChainlinkOracle.sol
 * @title ChainlinkOracle
 * @notice This oracle fetches prices of assets from the Chainlink oracle.
 */
contract ChainlinkOracle is OracleInterface, ProtocolOwner {
  struct TokenConfig {
    /// @notice Underlying token address, which can't be a null address
    /// @notice Used to check if a token is supported
    address asset;
    /// @notice Chainlink feed address
    address feed;
    /// @notice Price expiration period of this asset
    uint256 maxStalePeriod;
  }

  /// @notice Manually set an override price, useful under extenuating conditions such as price feed failure
  mapping(address => uint256) public prices;

  /// @notice Token config by assets
  mapping(address => TokenConfig) public tokenConfigs;

  /// @notice Emit when a price is manually set
  event PricePosted(address indexed asset, uint256 previousPriceMantissa, uint256 newPriceMantissa);

  /// @notice Emit when a token config is added
  event TokenConfigAdded(address indexed asset, address feed, uint256 maxStalePeriod);

  modifier notNullAddress(address someone) {
    if (someone == address(0)) revert("can't be zero address");
    _;
  }

  constructor(address _protocol) ProtocolOwner(_protocol) {}

  /**
   * @notice Manually set the price of a given asset
   * @param asset Asset address
   * @param price Asset price in 18 decimals
   * @custom:access Only Governance
   * @custom:event Emits PricePosted event on succesfully setup of asset price
   */
  function setDirectPrice(address asset, uint256 price) external notNullAddress(asset) onlyOwner {
    uint256 previousPriceMantissa = prices[asset];
    prices[asset] = price;
    emit PricePosted(asset, previousPriceMantissa, price);
  }

  /**
   * @notice Add multiple token configs at the same time
   * @param tokenConfigs_ config array
   * @custom:access Only Governance
   * @custom:error Zero length error thrown, if length of the array in parameter is 0
   */
  function setTokenConfigs(TokenConfig[] memory tokenConfigs_) external {
    if (tokenConfigs_.length == 0) revert("length can't be 0");
    uint256 numTokenConfigs = tokenConfigs_.length;
    for (uint256 i; i < numTokenConfigs; ) {
      setTokenConfig(tokenConfigs_[i]);
      unchecked {
        ++i;
      }
    }
  }

  /**
   * @notice Add single token config. asset & feed cannot be null addresses and maxStalePeriod must be positive
   * @param tokenConfig Token config struct
   * @custom:access Only Governance
   * @custom:error NotNullAddress error is thrown if asset address is null
   * @custom:error NotNullAddress error is thrown if token feed address is null
   * @custom:error Range error is thrown if maxStale period of token is not greater than zero
   * @custom:event Emits TokenConfigAdded event on succesfully setting of the token config
   */
  function setTokenConfig(
    TokenConfig memory tokenConfig
  ) public notNullAddress(tokenConfig.asset) notNullAddress(tokenConfig.feed) onlyOwner {
    if (tokenConfig.maxStalePeriod == 0) revert("stale period can't be zero");
    tokenConfigs[tokenConfig.asset] = tokenConfig;
    emit TokenConfigAdded(tokenConfig.asset, tokenConfig.feed, tokenConfig.maxStalePeriod);
  }

  /**
   * @notice Gets the price of a asset from the chainlink oracle
   * @param asset Address of the asset
   * @return Price in USD from Chainlink or a manually set price for the asset
   */
  function getPrice(address asset) public view virtual returns (uint256) {
    uint256 manualPrice = prices[asset];
    if (manualPrice != 0) {
      return manualPrice;
    }

    return _getChainlinkPrice(asset);
  }

  /**
   * @notice Get the Chainlink price for an asset, revert if token config doesn't exist
   * @dev The precision of the price feed is used to ensure the returned price has 18 decimals of precision
   * @param asset Address of the asset
   * @return price Price in USD, with 18 decimals of precision
   * @custom:error NotNullAddress error is thrown if the asset address is null
   * @custom:error Price error is thrown if the Chainlink price of asset is not greater than zero
   * @custom:error Timing error is thrown if current timestamp is less than the last updatedAt timestamp
   * @custom:error Timing error is thrown if time difference between current time and last updated time
   * is greater than maxStalePeriod
   */
  function _getChainlinkPrice(
    address asset
  ) private view notNullAddress(tokenConfigs[asset].asset) returns (uint256) {
    TokenConfig memory tokenConfig = tokenConfigs[asset];
    AggregatorV3Interface feed = AggregatorV3Interface(tokenConfig.feed);

    // note: maxStalePeriod cannot be 0
    uint256 maxStalePeriod = tokenConfig.maxStalePeriod;

    // Chainlink USD-denominated feeds store answers at 8 decimals, mostly
    uint256 decimalDelta = 18 - feed.decimals();

    (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
    if (answer <= 0) revert("chainlink price must be positive");
    if (block.timestamp < updatedAt) revert("updatedAt exceeds block time");

    uint256 deltaTime;
    unchecked {
      deltaTime = block.timestamp - updatedAt;
    }

    if (deltaTime > maxStalePeriod) revert("chainlink price expired");

    return uint256(answer) * (10 ** decimalDelta);
  }
}
