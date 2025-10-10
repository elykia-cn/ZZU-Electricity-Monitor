import logging
import os
import json
import smtplib
import zipfile
import io
from datetime import datetime
from email.mime.text import MIMEText
from glob import glob
from os import makedirs, path
from typing import List, Dict, Optional, Union

import pytz
import requests
from tenacity import (
    retry, 
    stop_after_attempt, 
    wait_exponential,
    wait_chain,
    wait_fixed,
    retry_if_exception_type
)
from zzupy.app import CASClient, ECardClient

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 常量定义
THRESHOLD = 10.0
EXCELLENT_THRESHOLD = 100.0
JSON_FOLDER_PATH = "./page/data"
TOKEN_ZIP_PATH = path.join(JSON_FOLDER_PATH, "tokens.zip")

# 重试配置常量
RETRY_ATTEMPTS = 5
RETRY_MULTIPLIER = 1
INITIAL_WAIT = 15
MAX_WAIT = 120

# 环境变量
ACCOUNT = os.getenv("ACCOUNT")
PASSWORD = os.getenv("PASSWORD")
LT_ROOM = os.getenv("lt_room")
AC_ROOM = os.getenv("ac_room")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
SERVERCHAN_KEYS = os.getenv("SERVERCHAN_KEYS")
EMAIL = os.getenv("EMAIL")
SMTP_CODE = os.getenv("SMTP_CODE")
SMTP_SERVER = os.getenv("SMTP_SERVER")


# 通用重试装饰器
def create_retry_decorator(stop_attempts=RETRY_ATTEMPTS, wait_strategy=None):
    """创建统一的重试装饰器"""
    if wait_strategy is None:
        wait_strategy = wait_exponential(
            multiplier=RETRY_MULTIPLIER, 
            min=INITIAL_WAIT, 
            max=MAX_WAIT
        )
    
    return retry(
        stop=stop_after_attempt(stop_attempts),
        wait=wait_strategy,
        retry=retry_if_exception_type(Exception),
        reraise=True
    )

# 通用的请求重试装饰器
request_retry = create_retry_decorator(
    wait_strategy=wait_chain(
        wait_fixed(15),  # 第一次等待15s
        wait_fixed(30),  # 第二次等待30s
        wait_exponential(multiplier=1, min=45, max=120)  # 后续按指数退避
    )
)

class TokenManager:
    """Token管理器，负责token的保存和读取"""
    
    @staticmethod
    def save_tokens(user_token: str, refresh_token: str) -> None:
        """保存token到加密的zip文件"""
        try:
            # 创建token数据
            token_data = {
                "user_token": user_token,
                "refresh_token": refresh_token,
                "saved_at": DataManager.get_cst_time_str("%Y-%m-%d %H:%M:%S")
            }
            
            # 将token数据转换为JSON字符串
            token_json = json.dumps(token_data, ensure_ascii=False, indent=2)
            
            # 创建内存中的zip文件
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                # 直接添加文件内容，不创建目录结构
                zip_file.writestr("tokens.json", token_json)
                # 设置密码加密 - 修复：将密码编码为bytes
                zip_file.setpassword(PASSWORD.encode('utf-8'))
            
            # 保存到文件
            with open(TOKEN_ZIP_PATH, 'wb') as f:
                f.write(zip_buffer.getvalue())
            
            logger.info(f"Token已保存到加密文件: {TOKEN_ZIP_PATH}")
            
        except Exception as e:
            logger.error(f"保存token失败: {e}")
            raise

    @staticmethod
    def load_tokens() -> Optional[Dict[str, str]]:
        """从加密的zip文件加载token"""
        try:
            if not path.exists(TOKEN_ZIP_PATH):
                logger.info("Token文件不存在，将使用账号密码登录")
                return None
            
            with open(TOKEN_ZIP_PATH, 'rb') as f:
                zip_buffer = io.BytesIO(f.read())
            
            with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
                # 设置解密密码 - 修复：将密码编码为bytes
                zip_file.setpassword(PASSWORD.encode('utf-8'))
                # 读取token文件
                with zip_file.open("tokens.json") as token_file:
                    token_data = json.load(token_file)
            
            logger.info(f"从文件加载token成功，保存时间: {token_data.get('saved_at', '未知')}")
            return token_data
            
        except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as e:
            logger.warning(f"读取token文件失败，将使用账号密码登录: {e}")
            return None
        except Exception as e:
            logger.error(f"加载token时发生错误: {e}")
            return None

class EnergyMonitor:
    """电量监控器，负责获取电量信息"""
    
    def __init__(self):
        self.cas_client = CASClient(ACCOUNT, PASSWORD)
        self.get_energy_balance = create_retry_decorator()(self._get_energy_balance)

    def _initialize_cas_client(self) -> bool:
        """初始化CAS客户端，尝试使用token登录"""
        # 尝试从文件加载token
        token_data = TokenManager.load_tokens()
        
        if token_data and token_data.get('user_token') and token_data.get('refresh_token'):
            try:
                logger.info("尝试使用保存的token登录...")
                self.cas_client.set_token(token_data['user_token'], token_data['refresh_token'])
                self.cas_client.login()
                
                if self.cas_client.logged_in:
                    logger.info("使用保存的token登录成功")
                    return True
                else:
                    logger.warning("保存的token已失效，将使用账号密码重新登录")
            except Exception as e:
                logger.warning(f"使用token登录失败: {e}，将使用账号密码登录")
        
        # 使用账号密码登录
        logger.info("使用账号密码进行CAS认证...")
        self.cas_client.login()
        
        if self.cas_client.logged_in:
            logger.info("CAS认证成功")
            # 保存新的token
            try:
                TokenManager.save_tokens(self.cas_client.user_token, self.cas_client.refresh_token)
            except Exception as e:
                logger.error(f"保存token失败: {e}，但登录成功，继续执行")
            return True
        else:
            logger.error("CAS认证失败")
            return False

    def _get_energy_balance(self) -> Dict[str, float]:
        """使用新的 zzupy 库获取电量余额"""
        # 初始化CAS客户端
        if not self._initialize_cas_client():
            raise Exception("CAS认证失败，无法获取电量信息")
        
        logger.info("创建一卡通客户端并登录...")
        try:
            with ECardClient(self.cas_client) as ecard:
                ecard.login()
                logger.info("一卡通系统登录成功")
                
                logger.info("获取照明和空调电量余额...")
                lt_balance = ecard.get_remaining_energy(room=LT_ROOM)
                ac_balance = ecard.get_remaining_energy(room=AC_ROOM)
                
                logger.info(f"照明剩余电量：{lt_balance} 度，空调剩余电量：{ac_balance} 度")
                return {"lt_Balance": lt_balance, "ac_Balance": ac_balance}
        finally:
            # 确保资源被清理
            self._cleanup()

    def _cleanup(self):
        """清理资源"""
        try:
            # 尝试关闭底层的 httpx 客户端
            if hasattr(self.cas_client, '_client') and self.cas_client._client:
                self.cas_client._client.close()
        except Exception as e:
            logger.debug(f"清理资源时出错: {e}")

class NotificationManager:
    """通知管理器，负责发送各种通知"""
    
    @staticmethod
    def format_balance_report(lt_balance: float, ac_balance: float, escape_dot: bool = False) -> str:
        """格式化电量报告信息"""
        def get_status(balance: float) -> str:
            if balance > EXCELLENT_THRESHOLD:
                return "充足"
            elif balance > THRESHOLD:
                return "还行"
            else:
                return "⚠️警告"

        lt_status = get_status(lt_balance)
        ac_status = get_status(ac_balance)

        # 根据 escape_dot 参数决定是否转义 '.'
        lt_balance_str = str(lt_balance).replace(".", "\\.") if escape_dot else str(lt_balance)
        ac_balance_str = str(ac_balance).replace(".", "\\.") if escape_dot else str(ac_balance)

        return (
            f"💡 照明剩余电量：{lt_balance_str} 度（{lt_status}）\n"
            f"❄️ 空调剩余电量：{ac_balance_str} 度（{ac_status}）\n\n"
        )

    @staticmethod
    def is_low_energy(balances: Dict[str, float]) -> bool:
        """判断是否低电量"""
        return balances['lt_Balance'] <= THRESHOLD or balances['ac_Balance'] <= THRESHOLD

    @staticmethod
    @request_retry
    def send_serverchan_notification(title: str, content: str) -> None:
        """发送 Server 酱通知（带重试）"""
        if not SERVERCHAN_KEYS:
            logger.info("未配置 SERVERCHAN_KEYS，跳过 Server 酱通知")
            return
            
        logger.info("通过 Server 酱发送通知...")
        for key in SERVERCHAN_KEYS.split(','):
            key = key.strip()
            if not key:
                continue
                
            url = f"https://sctapi.ftqq.com/{key}.send"
            payload = {"title": title, "desp": content}
            
            response = requests.post(url, data=payload, timeout=10)
            try:
                result = response.json()
            except ValueError:
                logger.error("Server酱返回非 JSON，返回文本：%s", response.text)
                continue

            if result.get("code") == 0:
                logger.info(f"Server 酱通知发送成功，使用的密钥：{key}")
            else:
                logger.error(f"Server 酱通知发送失败，错误信息：{result.get('message')}")

    @staticmethod
    @create_retry_decorator()
    def send_email_notification(title: str, content: str) -> None:
        """发送邮件通知（带重试）"""
        if not all([EMAIL, SMTP_CODE, SMTP_SERVER]):
            logger.info("邮件配置不完整，跳过邮件通知")
            return
            
        logger.info("通过邮件发送通知...")
        
        msg = MIMEText(content, 'plain', 'utf-8')
        msg['Subject'] = title
        msg['From'] = EMAIL
        msg['To'] = EMAIL

        client = smtplib.SMTP_SSL(SMTP_SERVER, smtplib.SMTP_SSL_PORT)
        logger.info("连接到邮件服务器成功")
        client.login(EMAIL, SMTP_CODE)
        logger.info("登录成功")
        client.sendmail(EMAIL, EMAIL, msg.as_string())
        client.quit()
        logger.info("邮件发送成功")

    @staticmethod
    @request_retry
    def send_telegram_notification(title: str, content: str) -> None:
        """发送 Telegram 通知（带重试）"""
        if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
            logger.info("未配置 Telegram 参数，跳过 Telegram 通知")
            return
            
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": f"*{title}*\n\n{content}",
            "parse_mode": "MarkdownV2"
        }
        
        response = requests.post(url, data=payload, timeout=10)
        result = response.json()

        if not result.get("ok"):
            raise requests.exceptions.RequestException(result.get("description"))
        
        logger.info("Telegram 通知发送成功")

    @classmethod
    def notify_admin(cls, title: str, balances: Dict[str, float]) -> None:
        """通过所有可用渠道发送通知"""
        logger.info("准备发送通知...")
        
        is_low_energy = cls.is_low_energy(balances)
        email_content = cls.format_balance_report(balances["lt_Balance"], balances["ac_Balance"], escape_dot=False)
        
        if is_low_energy:
            email_content += "⚠️ 电量不足，请尽快充电！"
            cls.send_serverchan_notification(title, email_content)
            cls.send_email_notification(title, email_content)
        else:
            logger.info("电量充足，跳过 Server 酱和邮件通知")

        # 总是发送 Telegram 通知
        telegram_content = cls.format_balance_report(balances["lt_Balance"], balances["ac_Balance"], escape_dot=True)
        telegram_content += "⚠️ 电量不足，请尽快充电！" if is_low_energy else "当前电量充足，请保持关注。"
        
        cls.send_telegram_notification(title, telegram_content)


class DataManager:
    """数据管理器，负责数据的存储和读取"""
    
    @staticmethod
    def get_cst_time_str(format_str: str) -> str:
        """获取当前 CST（北京时间）并按照指定格式返回"""
        cst_tz = pytz.timezone('Asia/Shanghai')
        cst_time = datetime.now(cst_tz)
        return cst_time.strftime(format_str)

    @staticmethod
    def load_data_from_json(file_path: str) -> Optional[List[Dict]]:
        """从 JSON 文件加载数据"""
        try:
            with open(file_path, "r", encoding="utf-8") as file:
                return json.load(file)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            logger.warning(f"加载JSON文件失败 {file_path}: {e}")
            return None

    @staticmethod
    def dump_data_into_json(data: Union[List, Dict], file_path: str, indent: int = 4) -> None:
        """将数据保存到 JSON 文件中"""
        try:
            dirpath = path.dirname(file_path)
            if dirpath and not path.exists(dirpath):
                makedirs(dirpath, exist_ok=True)
                
            with open(file_path, "w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=indent)
            logger.info(f"数据成功保存到文件：{file_path}")
        except Exception as e:
            logger.error(f"保存数据到文件失败：{file_path}，错误信息：{e}")

    @classmethod
    def record_data(cls, data: Dict) -> Optional[List[Dict]]:
        """将最新的电量数据记录到 JSON 文件"""
        file_path = f"{JSON_FOLDER_PATH}/{cls.get_cst_time_str('%Y-%m')}.json"
        existing_data = cls.load_data_from_json(file_path) or []
        
        existing_data.append(data)
        cls.dump_data_into_json(existing_data, file_path)
        return existing_data

    @classmethod
    def update_time_list(cls) -> List[str]:
        """更新时间列表，获取存储的所有 JSON 文件名"""
        if not path.exists(JSON_FOLDER_PATH):
            raise FileNotFoundError(f"文件夹路径不存在：{JSON_FOLDER_PATH}")

        time_json_path = './page/data/time.json'
        if not path.exists(time_json_path):
            logger.warning("time.json 文件不存在，正在创建空文件...")
            cls.dump_data_into_json([], time_json_path)

        json_files = [
            path.splitext(path.basename(it))[0] 
            for it in glob(path.join(JSON_FOLDER_PATH, "????-??.json"))
        ]
        json_files = sorted(json_files, key=lambda x: datetime.strptime(x, '%Y-%m'), reverse=True)

        cls.dump_data_into_json(json_files, time_json_path)
        logger.info("时间列表更新成功")
        return json_files

    @classmethod
    def parse_and_update_data(cls, existing_data: Optional[List[Dict]]) -> None:
        """解析并更新数据，确保最多保留 30 条记录"""
        time_file_list = cls.update_time_list()
        existing_data_length = len(existing_data) if existing_data else 0

        if existing_data_length < 30 and len(time_file_list) > 1:
            prev_month_data = cls.load_data_from_json(f"{JSON_FOLDER_PATH}/{time_file_list[1]}.json") or []
            records_to_retrieve = min(30 - existing_data_length, len(prev_month_data))
            existing_data = prev_month_data[-records_to_retrieve:] + (existing_data or [])

        cls.dump_data_into_json((existing_data or [])[-30:], f"{JSON_FOLDER_PATH}/last_30_records.json")
        logger.info("数据解析和更新完成")


def main():
    """主函数"""
    logger.info("启动宿舍电量监控程序...")
    
    # 检查必要的环境变量
    required_env_vars = ["ACCOUNT", "PASSWORD", "lt_room", "ac_room"]
    missing_vars = [var for var in required_env_vars if not os.getenv(var)]
    
    if missing_vars:
        logger.error(f"缺少必要的环境变量: {', '.join(missing_vars)}")
        return
    
    monitor = EnergyMonitor()
    try:
        balances = monitor.get_energy_balance()
    except Exception as e:
        logger.error("获取电量失败：%s", e)
        return

    title = "⚠️宿舍电量预警⚠️" if NotificationManager.is_low_energy(balances) else "🏠宿舍电量通报🏠"
    NotificationManager.notify_admin(title, balances)

    latest_record = {
        "time": DataManager.get_cst_time_str("%m-%d %H:%M:%S"),
        "lt_Balance": balances["lt_Balance"],
        "ac_Balance": balances["ac_Balance"]
    }
    
    data = DataManager.record_data(latest_record)
    DataManager.parse_and_update_data(data)

if __name__ == "__main__":
    main()
