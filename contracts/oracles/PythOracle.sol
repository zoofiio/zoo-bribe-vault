// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/SignedMath.sol";

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import "../interfaces/OracleInterface.sol";
import "../libs/Constants.sol";
import "../settings/ProtocolOwner.sol";

/**
 * @dev Updated from https://github.com/VenusProtocol/oracle/blob/develop/contracts/oracles/PythOracle.sol
 * @title PythOracle
 * @notice PythOracle contract reads prices from actual Pyth oracle contract which accepts, verifies and stores
 * the updated prices from external sources
 */
contract PythOracle is OracleInterface, ProtocolOwner {
  // To calculate 10 ** n(which is a signed type)
  using SignedMath for int256;

  // To cast int64/int8 types from Pyth to unsigned types
  using SafeCast for int256;

  struct TokenConfig {
    bytes32 pythId;
    address asset;
    uint64 maxStalePeriod;
  }

  /// @notice Exponent scale (decimal precision) of prices
  uint256 public constant EXP_SCALE = 1e18;

  /// @notice The actual pyth oracle address fetch & store the prices
  IPyth public underlyingPythOracle;

  /// @notice Token configs by asset address
  mapping(address => TokenConfig) public tokenConfigs;

  /// @notice Emit when setting a new pyth oracle address
  event PythOracleSet(address indexed oldPythOracle, address indexed newPythOracle);

  /// @notice Emit when a token config is added
  event TokenConfigAdded(address indexed asset, bytes32 indexed pythId, uint64 indexed maxStalePeriod);

  modifier notNullAddress(address someone) {
    if (someone == address(0)) revert("can't be zero address");
    _;
  }

  constructor(
    address _protocol,
    address underlyingPythOracle_
  ) notNullAddress(underlyingPythOracle_) ProtocolOwner(_protocol) {
    underlyingPythOracle = IPyth(underlyingPythOracle_);
    emit PythOracleSet(address(0), underlyingPythOracle_);
  }

  /**
   * @notice Batch set token configs
   * @param tokenConfigs_ Token config array
   * @custom:access Only Governance
   * @custom:error Zero length error is thrown if length of the array in parameter is 0
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
   * @notice Set the underlying Pyth oracle contract address
   * @param underlyingPythOracle_ Pyth oracle contract address
   * @custom:access Only Governance
   * @custom:error NotNullAddress error thrown if underlyingPythOracle_ address is zero
   * @custom:event Emits PythOracleSet event with address of Pyth oracle.
   */
  function setUnderlyingPythOracle(
    IPyth underlyingPythOracle_
  ) external notNullAddress(address(underlyingPythOracle_)) onlyOwner {
    IPyth oldUnderlyingPythOracle = underlyingPythOracle;
    underlyingPythOracle = underlyingPythOracle_;
    emit PythOracleSet(address(oldUnderlyingPythOracle), address(underlyingPythOracle_));
  }

  /**
   * @notice Set single token config. `maxStalePeriod` cannot be 0 and `asset` cannot be a null address
   * @param tokenConfig Token config struct
   * @custom:access Only Governance
   * @custom:error Range error is thrown if max stale period is zero
   * @custom:error NotNullAddress error is thrown if asset address is null
   */
  function setTokenConfig(TokenConfig memory tokenConfig) public notNullAddress(tokenConfig.asset) onlyOwner {
    if (tokenConfig.maxStalePeriod == 0) revert("max stale period cannot be 0");
    tokenConfigs[tokenConfig.asset] = tokenConfig;
    emit TokenConfigAdded(tokenConfig.asset, tokenConfig.pythId, tokenConfig.maxStalePeriod);
  }

  /**
   * @notice Gets the price of a asset from the pyth oracle
   * @param asset Address of the asset
   * @return Price in USD
   */
  function getPrice(address asset) public view returns (uint256) {
    TokenConfig storage tokenConfig = tokenConfigs[asset];
    if (tokenConfig.asset == address(0)) revert("asset doesn't exist");

    // if the price is expired after it's compared against `maxStalePeriod`, the following call will revert
    PythStructs.Price memory priceInfo = underlyingPythOracle.getPriceNoOlderThan(
      tokenConfig.pythId,
      tokenConfig.maxStalePeriod
    );

    uint256 price = int256(priceInfo.price).toUint256();

    if (price == 0) revert("invalid pyth oracle price");

    // the price returned from Pyth is price ** 10^expo, which is the real dollar price of the assets
    // we need to multiply it by 1e18 to make the price 18 decimals
    if (priceInfo.expo > 0) {
      return price * EXP_SCALE * (10 ** int256(priceInfo.expo).toUint256());
    } else {
      return ((price * EXP_SCALE) / (10 ** int256(-priceInfo.expo).toUint256()));
    }
  }
}