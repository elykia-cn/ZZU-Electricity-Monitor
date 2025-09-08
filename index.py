import logging
import os
import json
import smtplib
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
    wait_fixed, 
    retry_if_exception_type
)
from zzupy import ZZUPy

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 常量定义
THRESHOLD = 10.0
EXCELLENT_THRESHOLD = 100.0
JSON_FOLDER_PATH = "./page/data"
MAX_DISPLAY_NUM = 30

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


class EnergyMonitor:
    """电量监控器，负责获取电量信息"""
    
    def __init__(self):
        self.zzupy = ZZUPy(ACCOUNT, PASSWORD)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=10),
        retry=retry_if_exception_type(Exception),
        reraise=True
    )
    def get_energy_balance(self) -> Dict[str, float]:
        """使用 ZZUPy 库获取电量余额（带重试）"""
        logger.info("尝试登录 ZZUPy 系统...")
        self.zzupy.login()
        logger.info("登录成功")
        
        logger.info("获取照明和空调电量余额...")
        lt_balance = self.zzupy.eCard.get_remaining_power(LT_ROOM)
        ac_balance = self.zzupy.eCard.get_remaining_power(AC_ROOM)
        
        logger.info(f"照明剩余电量：{lt_balance} 度，空调剩余电量：{ac_balance} 度")
        return {"lt_Balance": lt_balance, "ac_Balance": ac_balance}


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
    def send_serverchan_notification(title: str, content: str) -> None:
        """发送 Server 酱通知"""
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
            
            try:
                response = post_with_retry(url, payload)
                try:
                    result = response.json()
                except ValueError:
                    logger.error("Server酱返回非 JSON，返回文本：%s", response.text)
                    continue

                if result.get("code") == 0:
                    logger.info(f"Server 酱通知发送成功，使用的密钥：{key}")
                else:
                    logger.error(f"Server 酱通知发送失败，错误信息：{result.get('message')}")
            except Exception as e:
                logger.error(f"Server 酱请求异常（密钥 {key}）：{e}")

    @staticmethod
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=15),
        retry=retry_if_exception_type(smtplib.SMTPException),
        reraise=True
    )
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
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_fixed(10),
        retry=retry_if_exception_type(requests.exceptions.RequestException),
        reraise=True
    )
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
        try:
            result = response.json()
        except ValueError:
            logger.error("Telegram 返回非 JSON：%s", response.text)
            raise requests.exceptions.RequestException("Telegram 返回非 JSON")

        if result.get("ok"):
            logger.info("Telegram 通知发送成功")
        else:
            raise requests.exceptions.RequestException(result.get("description"))

    @classmethod
    def notify_admin(cls, title: str, balances: Dict[str, float]) -> None:
        """通过所有可用渠道发送通知"""
        logger.info("准备发送通知...")
        
        is_low_energy = cls.is_low_energy(balances)
        email_content = cls.format_balance_report(balances["lt_Balance"], balances["ac_Balance"], escape_dot=False)
        
        if is_low_energy:
            email_content += "⚠️ 电量不足，请尽快充电！"
            cls.send_serverchan_notification(title, email_content)
            
            try:
                cls.send_email_notification(title, email_content)
            except Exception as e:
                logger.error(f"邮件发送失败：{e}")
        else:
            logger.info("电量充足，跳过 Server 酱和邮件通知")

        # 总是发送 Telegram 通知
        telegram_content = cls.format_balance_report(balances["lt_Balance"], balances["ac_Balance"], escape_dot=True)
        telegram_content += "⚠️ 电量不足，请尽快充电！" if is_low_energy else "当前电量充足，请保持关注。"
        
        try:
            cls.send_telegram_notification(title, telegram_content)
        except Exception as e:
            logger.error(f"Telegram 通知最终失败：{e}")


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
        except FileNotFoundError:
            logger.warning(f"文件未找到：{file_path}")
            return None
        except json.JSONDecodeError:
            logger.error(f"文件内容无法解析为 JSON：{file_path}")
            return None

    @staticmethod
    def dump_data_into_json(data: Union[List, Dict], file_path: str, indent: int = 4) -> None:
        """将数据保存到 JSON 文件中"""
        try:
            # 确保目录存在
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

        # 检查是否与最后一条记录相同
        if existing_data and existing_data[-1]["lt_Balance"] == data["lt_Balance"] and existing_data[-1]["ac_Balance"] == data["ac_Balance"]:
            logger.info("最新数据与最后一条记录一致，跳过保存")
            return existing_data

        existing_data.append(data)
        cls.dump_data_into_json(existing_data, file_path)
        return existing_data

    @classmethod
    def update_time_list(cls) -> List[str]:
        """更新时间列表，获取存储的所有 JSON 文件名"""
        if not path.exists(JSON_FOLDER_PATH):
            raise FileNotFoundError(f"文件夹路径不存在：{JSON_FOLDER_PATH}")

        # 检查是否存在 time.json 文件，如果不存在则创建一个空文件
        time_json_path = './page/data/time.json'
        if not path.exists(time_json_path):
            logger.warning("time.json 文件不存在，正在创建空文件...")
            cls.dump_data_into_json([], time_json_path)

        # 获取 JSON 文件夹下所有符合条件的文件名并按时间排序
        json_files = [
            path.splitext(path.basename(it))[0] 
            for it in glob(path.join(JSON_FOLDER_PATH, "????-??.json"))
        ]
        json_files = sorted(json_files, key=lambda x: datetime.strptime(x, '%Y-%m'), reverse=True)

        # 将最新的时间列表更新到 time.json 文件中
        cls.dump_data_into_json(json_files, time_json_path)
        logger.info("时间列表更新成功")
        return json_files

    @classmethod
    def parse_and_update_data(cls, existing_data: Optional[List[Dict]]) -> None:
        """解析并更新数据，确保最多保留 30 条记录"""
        time_file_list = cls.update_time_list()
        existing_data_length = len(existing_data) if existing_data else 0

        if existing_data_length < MAX_DISPLAY_NUM and len(time_file_list) > 1:
            prev_month_data = cls.load_data_from_json(f"{JSON_FOLDER_PATH}/{time_file_list[1]}.json") or []
            records_to_retrieve = min(MAX_DISPLAY_NUM - existing_data_length, len(prev_month_data))
            existing_data = prev_month_data[-records_to_retrieve:] + (existing_data or [])

        cls.dump_data_into_json((existing_data or [])[-MAX_DISPLAY_NUM:], f"{JSON_FOLDER_PATH}/last_30_records.json")
        logger.info("数据解析和更新完成")


# 通用的 requests.post 带重试：Server酱用（3 次，15s,30s,60s）
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=15),
    retry=retry_if_exception_type(requests.exceptions.RequestException),
    reraise=True
)
def post_with_retry(url: str, data: Dict) -> requests.Response:
    """带重试的 POST 请求"""
    return requests.post(url, data=data, timeout=10)


def main():
    """主函数"""
    logger.info("启动宿舍电量监控程序...")
    
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
    logger.info("程序运行结束")


if __name__ == "__main__":
    main()